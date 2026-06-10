"""
briefly_api/agents/pipeline.py

The main pipeline orchestrator.
Runs all agents in sequence for a single user.

Each agent is a pure async function: context → context
Any agent failure is caught, logged, and the pipeline continues
(degraded output is better than no output).
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

from briefly_api.agents import (
    audio,
    cleaner,
    collector,
    deduplication,
    delivery,
    interest_discovery,
    learning,
    memory,
    novelty,
    planner,
    briefing_writer,
    citation_verifier,
    relevance,
    brain_dump_injector,
    browser_capture_injector,
    content_discovery_injector,
)
from briefly_api.agents.context import PipelineContext, UserContext
from briefly_api.config import get_settings
from briefly_api.db.engine import get_session_factory
from briefly_api.db.models import (
    ContentEnrichmentCache,
    Digest,
    DigestItem,
    DigestStatus,
)
from briefly_api.db.queries import (
    get_user_with_profile,
    get_active_sources,
    get_recent_digest_items,
    get_seen_content_hashes,
    get_active_story_threads,
)

log = logging.getLogger(__name__)


async def run_for_user(user_id: str, run_date: str | None = None) -> dict:
    """
    Run the full Briefly pipeline for one user.
    Returns a summary dict with success/failure status.

    Args:
        user_id:  User to generate digest for
        run_date: YYYY-MM-DD (defaults to today UTC)
    """
    s = get_settings()
    if not run_date:
        run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    log.info("Pipeline starting: user=%s date=%s", user_id, run_date)

    try:
        async with get_session_factory()() as session:
            return await asyncio.wait_for(
                _run_pipeline(session, user_id, run_date, s),
                timeout=300.0,  # match briefing worker budget (+ audio)
            )
    except asyncio.TimeoutError:
        log.error("Pipeline timed out (>3 min) for user %s", user_id)
        return {"success": False, "error": "Briefing took too long to generate. Please try again — it will be faster next time."}
    except Exception as exc:
        log.exception("Pipeline failed for user %s", user_id)
        return {"success": False, "error": f"Briefing pipeline error: {exc}"}


async def _run_pipeline(session, user_id: str, run_date: str, s) -> dict:
        # Load user context from DB
        user_data = await get_user_with_profile(session, user_id)
        if not user_data:
            log.error("Pipeline: user %s not found", user_id)
            return {"success": False, "error": "User not found"}

        recent_items   = await get_recent_digest_items(session, user_id, days=7)
        seen_hashes    = await get_seen_content_hashes(session, user_id, days=30)
        story_threads  = await get_active_story_threads(session, user_id)
        sources        = await get_active_sources(session, user_id)
        from briefly_api.services.connectors.types import FETCHABLE_SOURCE_TYPES
        fetchable_sources = [s for s in sources if s.source_type in FETCHABLE_SOURCE_TYPES]
        if not fetchable_sources:
            return {
                "success": False,
                "error": "Add at least one source (RSS, YouTube, Reddit, or website URL) to generate a briefing.",
            }

        user_ctx = UserContext(
            user_id=user_id,
            email=user_data["email"],
            name=user_data.get("name"),
            plan=user_data.get("plan", "free"),
            is_pro=bool(user_data.get("is_pro")),
            profile=user_data.get("profile", {}),
            recent_digest_items=recent_items,
            seen_content_hashes=seen_hashes,
            active_story_threads=story_threads,
            topic_clusters=user_data.get("profile", {}).get("topic_clusters", []),
            sources=fetchable_sources,
        )

        from briefly_api.services.briefing_generation import get_briefing_generation_meta

        gen_meta = await get_briefing_generation_meta(user_id)
        ctx = PipelineContext(
            user=user_ctx,
            run_date=run_date,
            force_refresh=bool(gen_meta.get("force_refresh")),
        )
        ctx.db_session = session

        # ── Run agents in sequence ────────────────────────────────────────────
        # Each agent is wrapped in try/except — pipeline degrades gracefully

        ctx = await _run_agent("SourceCollectorAgent", collector.run, ctx)
        if not ctx.raw_items:
            log.warning("Pipeline: no content ingested for user %s", user_id)
            return {"success": False, "error": "No content ingested", "items": 0}

        ctx = await _run_agent("ContentCleanerAgent",    cleaner.run,          ctx)
        ctx = await _run_agent("DeduplicationAgent",     deduplication.run,    ctx)
        ctx = await _run_agent("RelevanceAgent",         relevance.run,        ctx)

        if not ctx.has_enough_items:
            log.warning("Pipeline: insufficient relevant items for user %s (%d)", user_id, len(ctx.scored_items))
            # Don't fail — send what we have with a note

        ctx = await _run_agent("NoveltyAgent",           novelty.run,          ctx)
        ctx = await _run_agent("MemoryAgent",            memory.run,           ctx)
        ctx = await _run_agent("BriefingPlannerAgent",   planner.run,          ctx)

        # ── Load proactive intelligence layer before writer ───────────────────
        # Populates ctx.enrichment_cache, ctx.behavioral_fingerprint_text, and
        # ctx.proactive_events so BriefingWriterAgent can use pre-computed context.
        ctx = await _load_proactive_context(session, ctx)

        from briefly_api.agents import serendipity as serendipity_agent
        ctx = await _run_agent("SerendipityAgent", serendipity_agent.run, ctx)

        ctx = await _run_agent("BriefingWriterAgent",    briefing_writer.run,  ctx)
        ctx = await _run_agent("ContentDiscoveryInjectorAgent", content_discovery_injector.run, ctx)

        # Persist guard: planner selected items but writer produced none → fallback drafts
        if ctx.selected_item_ids and not ctx.digest_items:
            log.warning(
                "Pipeline: writer returned 0 items despite %d selected — using fallback drafts",
                len(ctx.selected_item_ids),
            )
            ctx.digest_items = briefing_writer.build_fallback_drafts(ctx)
            ctx.total_shown = len(ctx.digest_items)
            if not ctx.subject_line:
                ctx.subject_line = f"Your briefing — {ctx.run_date}"
            if not ctx.preview_text and ctx.digest_items:
                ctx.preview_text = ctx.digest_items[0].headline[:120]

        ctx = await _run_agent("BrainDumpInjectorAgent", brain_dump_injector.run, ctx)
        ctx = await _run_agent("BrowserCaptureInjectorAgent", browser_capture_injector.run, ctx)
        ctx = await _run_agent("CitationVerifierAgent",  citation_verifier.run, ctx)
        ctx = await _run_agent("AudioAgent",             audio.run,            ctx)
        ctx = await _run_agent("DeliveryAgent",          delivery.run,         ctx)

        # ── Persist digest to DB ──────────────────────────────────────────────
        if not ctx.digest_items or ctx.total_shown <= 0:
            if ctx.selected_item_ids:
                log.error(
                    "Pipeline: refusing to persist empty digest for user %s (%d items planned)",
                    user_id,
                    len(ctx.selected_item_ids),
                )
                return {
                    "success": False,
                    "error": "Briefing writer failed to produce items",
                    "items": 0,
                    "errors": ctx.pipeline_errors,
                }
            log.warning(
                "Pipeline: no briefing items selected for user %s (scored=%d)",
                user_id,
                len(ctx.scored_items),
            )
            return {
                "success": False,
                "error": (
                    "No relevant stories found in your sources right now. "
                    "Try refreshing sources in the sidebar, or check back after overnight ingestion."
                ),
                "items": 0,
                "errors": ctx.pipeline_errors,
            }

        digest_id = await _persist_digest(session, ctx)

        # Mark ingested pool rows as processed (only rows that exist in raw_contents)
        from sqlalchemy import select as sa_select
        from briefly_api.db.models import RawContent

        candidate_ids = [
            d.content_id for d in ctx.digest_items
            if d.content_id and any(
                i.id == d.content_id
                and (i.meta.get("from_pool") or i.meta.get("live_fetch"))
                for i in ctx.enriched_items
            )
        ]
        if candidate_ids:
            rows = await session.execute(
                sa_select(RawContent.id).where(
                    RawContent.user_id == ctx.user.user_id,
                    RawContent.id.in_(candidate_ids),
                )
            )
            content_ids = [row[0] for row in rows.all()]
            if content_ids:
                from briefly_api.services.content_ingestion import mark_contents_processed
                await mark_contents_processed(session, content_ids)
                await session.commit()

        # ── Post-delivery learning & discovery ───────────────────────────────
        # These agents improve future digests but have zero effect on what the
        # user is about to read RIGHT NOW.  Run them in a separate background
        # task so the pipeline can return the digest_id immediately.
        asyncio.create_task(_run_post_pipeline_agents(user_id))
        log.info("Pipeline: scheduled post-pipeline agents for user %s", user_id)

        duration_ms = ctx.pipeline_duration_ms
        log.info(
            "Pipeline complete: user=%s items=%d duration=%dms errors=%d",
            user_id, ctx.total_shown, duration_ms, len(ctx.pipeline_errors),
        )

        warnings = [
            e["error"]
            for e in ctx.pipeline_errors
            if e.get("agent") == "SourceCollectorAgent" and e.get("error")
        ]

        return {
            "success": True,
            "digest_id": digest_id,
            "total_ingested": ctx.total_ingested,
            "total_shown": ctx.total_shown,
            "duration_ms": duration_ms,
            "errors": ctx.pipeline_errors,
            "warnings": warnings,
        }


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _load_proactive_context(session, ctx: PipelineContext) -> PipelineContext:
    """
    Load pre-computed intelligence into PipelineContext before the writer runs.

    Specifically:
      1. ContentEnrichmentCache rows for all selected items
         → ctx.enrichment_cache (keyed by content_id)
      2. BehavioralFingerprint text for the user
         → ctx.behavioral_fingerprint_text
      3. Pending ProactiveSurfacingEvents (highest priority, not yet surfaced)
         → ctx.proactive_events
    """
    user_id = ctx.user.user_id
    selected_ids = set(ctx.selected_item_ids)

    # ── 1. Enrichment cache ───────────────────────────────────────────────────
    try:
        from sqlalchemy import select as sa_select
        cache_result = await session.execute(
            sa_select(ContentEnrichmentCache).where(
                ContentEnrichmentCache.user_id == user_id,
                ContentEnrichmentCache.content_id.in_(selected_ids),
            )
        )
        rows = cache_result.scalars().all()
        ctx.enrichment_cache = {
            row.content_id: {
                "why_relevant":               row.why_relevant,
                "connection_sentence":         row.connection_sentence,
                "thread_update":               row.thread_update,
                "thread_key":                  row.thread_key,
                "contradiction_flag":          row.contradiction_flag,
                "contradiction_explanation":   row.contradiction_explanation,
                "user_angle":                  row.user_angle,
                "connection_strength":         row.connection_strength,
            }
            for row in rows
        }
        log.debug(
            "Pipeline: enrichment cache loaded %d/%d items for user %s",
            len(ctx.enrichment_cache), len(selected_ids), user_id,
        )
    except Exception:
        log.debug("Pipeline: enrichment cache load failed — continuing without", exc_info=True)

    # ── 2. Behavioral fingerprint text ────────────────────────────────────────
    try:
        from briefly_api.services.behavioral_fingerprint import load_as_text
        ctx.behavioral_fingerprint_text = await load_as_text(session, user_id)
    except Exception:
        log.debug("Pipeline: behavioral fingerprint load failed — continuing without", exc_info=True)

    # ── 3. Proactive events ───────────────────────────────────────────────────
    try:
        from briefly_api.agents.proactive.proactive_surfacing import (
            get_pending_events,
            mark_surfaced,
        )
        events = await get_pending_events(session, user_id)
        ctx.proactive_events = events
        if events:
            await mark_surfaced(session, [e["id"] for e in events])
            log.info(
                "Pipeline: loaded %d proactive event(s) for user %s",
                len(events), user_id,
            )
    except Exception:
        log.debug("Pipeline: proactive events load failed — continuing without", exc_info=True)

    return ctx


_AGENT_PROGRESS_LABELS: dict[str, str] = {
    "SourceCollectorAgent": "Collecting content from your sources…",
    "ContentCleanerAgent": "Cleaning and normalizing content…",
    "DeduplicationAgent": "Removing duplicate stories…",
    "RelevanceAgent": "Scoring relevance to your interests…",
    "NoveltyAgent": "Finding what's new for you…",
    "MemoryAgent": "Connecting to your reading history…",
    "BriefingPlannerAgent": "Planning your briefing…",
    "BriefingWriterAgent": "Writing your briefing…",
    "BrainDumpInjectorAgent": "Adding your saved notes…",
    "CitationVerifierAgent": "Verifying sources…",
    "DeliveryAgent": "Preparing delivery…",
}

# Hard per-agent wall-clock limits. An agent that exceeds its budget is
# cancelled and the pipeline continues with whatever state it had before.
_AGENT_TIMEOUTS: dict[str, float] = {
    "SourceCollectorAgent":   60.0,
    "ContentCleanerAgent":    15.0,
    "DeduplicationAgent":     15.0,
    "RelevanceAgent":         90.0,
    "NoveltyAgent":           15.0,
    "MemoryAgent":            15.0,
    "BriefingPlannerAgent":   30.0,
    "BriefingWriterAgent":    60.0,   # LLM has own 45s inner timeout
    "BrainDumpInjectorAgent": 15.0,
    "CitationVerifierAgent":  30.0,
    "AudioAgent":             120.0,
    "DeliveryAgent":          30.0,   # Resend has own 20s inner timeout
}

# Agents whose failure/timeout is non-fatal — logged but not counted as pipeline errors.
_OPTIONAL_AGENTS = frozenset({"AudioAgent"})


async def _run_agent(name: str, fn, ctx: PipelineContext) -> PipelineContext:
    """Run a single agent with error isolation, stage timing, and a hard timeout."""
    label = _AGENT_PROGRESS_LABELS.get(name)
    if label and ctx.user.user_id:
        try:
            from briefly_api.services.briefing_generation import report_briefing_progress

            asyncio.create_task(
                report_briefing_progress(
                    ctx.user.user_id,
                    status="running",
                    step=name,
                    label=label,
                )
            )
        except Exception:
            log.debug("Could not report briefing progress for %s", name, exc_info=True)

    timeout = _AGENT_TIMEOUTS.get(name, 30.0)
    started = time.perf_counter()
    try:
        log.debug("Running agent: %s (timeout=%.0fs)", name, timeout)
        ctx = await asyncio.wait_for(fn(ctx), timeout=timeout)
    except asyncio.TimeoutError:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        log.warning("Agent %s timed out after %dms — skipping", name, elapsed_ms)
        if name not in _OPTIONAL_AGENTS:
            ctx.log_error(name, f"Agent timed out after {timeout:.0f}s")
    except Exception as e:
        log.exception("Agent %s failed: %s", name, e)
        ctx.log_error(name, str(e))
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    log.info("Agent %s finished in %dms", name, elapsed_ms)
    ctx.__dict__.setdefault("stage_timings", {})[name] = elapsed_ms
    return ctx


async def _persist_digest(session, ctx: PipelineContext) -> str:
    """Save the generated digest to the database."""
    import uuid

    from sqlalchemy import select

    from briefly_api.db.models import RawContent
    from briefly_api.services.live_content_pool import ensure_digest_content_links

    await ensure_digest_content_links(session, ctx)

    existing = await session.execute(
        select(Digest).where(
            Digest.user_id == ctx.user.user_id,
            Digest.digest_date == ctx.run_date,
        )
    )
    old_digest = existing.scalar_one_or_none()
    if old_digest:
        await session.delete(old_digest)
        await session.flush()

    digest_id = str(uuid.uuid4())
    resend_message_id = ctx.__dict__.get("resend_message_id")
    # Truly filtered: failed relevance or matched never-show list
    _BLOCKED_LABELS = {
        "never_show":    "Topic you've blocked",
        "low_relevance": "Low relevance score",
        "too_old":       "Too old for today's digest",
    }
    blocked_items = [
        {
            "title":  item.title,
            "source": item.source_name or "",
            "reason": _BLOCKED_LABELS.get(item.drop_reason, item.drop_reason or "Filtered"),
            "score":  round(item.relevance_score, 2),
        }
        for item in list(getattr(ctx, "dropped_items", []))[:30]
    ]

    # Good fit but cut for length — these are bonus reading, not rejections
    crowded_out = list(getattr(ctx, "crowded_out_items", []))
    bonus_threshold = get_settings().relevance_threshold
    more_today = sorted(
        [i for i in crowded_out if i.relevance_score >= bonus_threshold],
        key=lambda i: i.relevance_score,
        reverse=True,
    )
    more_today_preview = [
        {
            "title":  item.title,
            "source": item.source_name or "",
            "url":    item.url or "",
            "score":  round(item.relevance_score, 2),
        }
        for item in more_today[:50]
    ]

    # Kept for backward compat — merged list used by older email renderer
    skipped_preview = blocked_items[:25]

    outcome = ctx.__dict__.get("outcome") or {}

    digest = Digest(
        id=digest_id,
        user_id=ctx.user.user_id,
        status=DigestStatus.sent if resend_message_id else (DigestStatus.ready if ctx.html_body else DigestStatus.failed),
        digest_date=ctx.run_date,
        subject_line=ctx.subject_line,
        preview_text=ctx.preview_text,
        html_body=ctx.html_body,
        web_body=ctx.web_body,
        total_items_ingested=ctx.total_ingested,
        total_items_scored=ctx.total_after_relevance,
        total_items_shown=ctx.total_shown,
        pipeline_duration_ms=ctx.pipeline_duration_ms,
        resend_message_id=resend_message_id,
        meta={
            "skipped": skipped_preview,
            "blocked": blocked_items,
            "more_today": more_today_preview,
            "stage_timings": ctx.__dict__.get("stage_timings", {}),
            "outcome": outcome,
            "serendipity": list(getattr(ctx, "serendipity_connections", []) or []),
            "proactive_events": list(getattr(ctx, "proactive_events", []) or []),
        },
    )
    session.add(digest)

    candidate_ids = {d.content_id for d in ctx.digest_items if d.content_id}
    valid_content_ids: set[str] = set()
    if candidate_ids:
        rows = await session.execute(
            select(RawContent.id).where(
                RawContent.user_id == ctx.user.user_id,
                RawContent.id.in_(candidate_ids),
            )
        )
        valid_content_ids = {row[0] for row in rows.all()}

    for draft in ctx.digest_items:
        content_id = (
            draft.content_id if draft.content_id in valid_content_ids else None
        )
        if draft.content_id and content_id is None:
            log.debug(
                "Digest persist: no raw_contents row for content_id %s — omitting FK for %r",
                draft.content_id,
                (draft.headline or "")[:80],
            )
        item = DigestItem(
            digest_id=digest_id,
            content_id=content_id,
            position=draft.position,
            section=draft.section,
            headline=draft.headline,
            summary=draft.summary,
            why_it_matters=draft.why_it_matters,
            source_name=draft.source_name,
            source_url=draft.source_url,
            all_sources=draft.all_sources,
            duplicate_count=draft.duplicate_count,
            memory_connections=draft.memory_connections,
            relevance_score=draft.relevance_score,
            novelty_score=draft.novelty_score,
            memory_reference=draft.memory_reference or None,
            confidence_signal=draft.confidence_signal or None,
            evolution_note=draft.evolution_note or None,
            contradiction_flag=bool(draft.contradiction_flag),
            contradiction_explanation=draft.contradiction_explanation or None,
        )
        session.add(item)

    await session.commit()

    injected_ids = ctx.__dict__.get("injected_brain_dump_ids") or []
    if injected_ids and ctx.db_session:
        from briefly_api.services import brain_dump as brain_dump_service
        await brain_dump_service.mark_dumps_injected(session, injected_ids, digest_id)
        await session.commit()

    capture_ids = ctx.__dict__.get("injected_browser_capture_ids") or []
    if capture_ids and ctx.db_session:
        from briefly_api.services import browser_capture as browser_capture_service
        await browser_capture_service.mark_captures_injected(session, capture_ids, digest_id)
        await session.commit()

    return digest_id


async def _run_post_pipeline_agents(user_id: str) -> None:
    """
    Learning and discovery agents run after the digest is already persisted
    and the user can see their brief.  They improve the next digest, not this one.
    Opens its own DB session so the main pipeline session can be closed first.
    """
    try:
        async with get_session_factory()() as session:
            # Minimal context — only what these agents need
            from briefly_api.agents.context import PipelineContext, UserContext
            from briefly_api.db.queries import get_user_with_profile

            user_data = await get_user_with_profile(session, user_id)
            if not user_data:
                return

            ctx = PipelineContext(
                user=UserContext(
                    user_id=user_id,
                    email=user_data["email"],
                    name=user_data.get("name"),
                    profile=user_data.get("profile", {}),
                    recent_digest_items=[],
                    seen_content_hashes=set(),
                    active_story_threads=[],
                    topic_clusters=user_data.get("profile", {}).get("topic_clusters", []),
                ),
                run_date="",
            )
            ctx.db_session = session

            ctx = await _run_agent("LearningAgent",          learning.run,          ctx)
            ctx = await _run_agent("InterestDiscoveryAgent", interest_discovery.run, ctx)
            try:
                await session.commit()
            except Exception as exc:
                log.warning("Post-pipeline commit failed for user %s: %s", user_id, exc)

    except Exception:
        log.exception("Post-pipeline agents failed for user %s — digest is unaffected", user_id)
