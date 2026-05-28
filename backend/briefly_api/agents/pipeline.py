"""
briefly_api/agents/pipeline.py

The main pipeline orchestrator.
Runs all agents in sequence for a single user.

Each agent is a pure async function: context → context
Any agent failure is caught, logged, and the pipeline continues
(degraded output is better than no output).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from briefly_api.agents import (
    cleaner,
    collector,
    deduplication,
    delivery,
    learning,
    memory,
    novelty,
    planner,
    briefing_writer,
    citation_verifier,
    relevance,
)
from briefly_api.agents.context import PipelineContext, UserContext
from briefly_api.config import get_settings
from briefly_api.db.engine import get_session_factory
from briefly_api.db.models import Digest, DigestItem, DigestStatus, UserMemory
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

    async with get_session_factory()() as session:
        # Load user context from DB
        user_data = await get_user_with_profile(session, user_id)
        if not user_data:
            log.error("Pipeline: user %s not found", user_id)
            return {"success": False, "error": "User not found"}

        recent_items   = await get_recent_digest_items(session, user_id, days=7)
        seen_hashes    = await get_seen_content_hashes(session, user_id, days=30)
        story_threads  = await get_active_story_threads(session, user_id)

        user_ctx = UserContext(
            user_id=user_id,
            email=user_data["email"],
            name=user_data.get("name"),
            profile=user_data.get("profile", {}),
            recent_digest_items=recent_items,
            seen_content_hashes=seen_hashes,
            active_story_threads=story_threads,
            topic_clusters=user_data.get("profile", {}).get("topic_clusters", []),
        )

        ctx = PipelineContext(user=user_ctx, run_date=run_date)

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
        ctx = await _run_agent("BriefingWriterAgent",    briefing_writer.run,  ctx)
        ctx = await _run_agent("CitationVerifierAgent",  citation_verifier.run, ctx)
        ctx = await _run_agent("DeliveryAgent",          delivery.run,         ctx)

        # ── Persist digest to DB ──────────────────────────────────────────────
        digest_id = await _persist_digest(session, ctx)

        # ── Learning agent runs async (doesn't block delivery) ───────────────
        # Will be triggered by webhook when user opens the email
        # For now, run synchronously after delivery
        ctx = await _run_agent("LearningAgent", learning.run, ctx)

        duration_ms = ctx.pipeline_duration_ms
        log.info(
            "Pipeline complete: user=%s items=%d duration=%dms errors=%d",
            user_id, ctx.total_shown, duration_ms, len(ctx.pipeline_errors),
        )

        return {
            "success": True,
            "digest_id": digest_id,
            "total_ingested": ctx.total_ingested,
            "total_shown": ctx.total_shown,
            "duration_ms": duration_ms,
            "errors": ctx.pipeline_errors,
        }


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _run_agent(name: str, fn, ctx: PipelineContext) -> PipelineContext:
    """Run a single agent with error isolation."""
    try:
        log.debug("Running agent: %s", name)
        ctx = await fn(ctx)
    except Exception as e:
        log.exception("Agent %s failed: %s", name, e)
        ctx.log_error(name, str(e))
    return ctx


async def _persist_digest(session, ctx: PipelineContext) -> str:
    """Save the generated digest to the database."""
    from briefly_api.db.models import Digest, DigestItem, DigestStatus
    import uuid

    digest_id = str(uuid.uuid4())
    digest = Digest(
        id=digest_id,
        user_id=ctx.user.user_id,
        status=DigestStatus.sent if ctx.html_body else DigestStatus.failed,
        digest_date=ctx.run_date,
        subject_line=ctx.subject_line,
        preview_text=ctx.preview_text,
        html_body=ctx.html_body,
        web_body=ctx.web_body,
        total_items_ingested=ctx.total_ingested,
        total_items_scored=ctx.total_after_relevance,
        total_items_shown=ctx.total_shown,
        pipeline_duration_ms=ctx.pipeline_duration_ms,
    )
    session.add(digest)

    for draft in ctx.digest_items:
        item = DigestItem(
            digest_id=digest_id,
            content_id=draft.content_id if draft.content_id else None,
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
        )
        session.add(item)

    await session.commit()
    return digest_id
