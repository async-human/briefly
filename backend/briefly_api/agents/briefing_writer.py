"""
briefly_api/agents/briefing_writer.py

The BriefingWriterAgent generates the actual digest users read.
This is where "this understands me" becomes visible.

Every item gets three things:
  1. A sharp headline
  2. A factual 2-sentence summary
  3. A personalized "why this matters to YOU" — the key differentiator

The agent also writes:
  - The subject line (must be compelling enough to open)
  - The preview text (shown in email clients before opening)
  - Section headers that feel personal not generic
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from briefly_api.agents.context import DigestItemDraft, PipelineContext, RawItem
from briefly_api.services.digest_sections import (
    SECTION_HIGHLY_RELEVANT,
    SECTION_WHATS_NEW,
)
from briefly_api.services.profile_utils import cluster_label
from briefly_api.services.article_urls import resolve_article_url

log = logging.getLogger(__name__)

# NarrativeSkill owns the system prompt and prompt building.
# The constants and templates that were here have moved to
# agents/skills/narrative_skill.py.


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Write the personalized briefing for all planned items.
    Populates ctx.digest_items, ctx.subject_line, ctx.preview_text.

    Now uses NarrativeSkill which:
      - Injects behavioral_fingerprint_text into the stable cached prefix
        (so Anthropic caches the fingerprint alongside the static profile)
      - Passes pre-computed enrichment (connection_sentence, why_relevant, etc.)
        per item so the model assembles rather than derives
    """
    from briefly_api.agents.skills.narrative_skill import NarrativeSkill

    selected_ids = set(ctx.selected_item_ids)
    item_map = {i.id: i for i in ctx.enriched_items if i.id in selected_ids}
    items_to_write = [item_map[iid] for iid in ctx.selected_item_ids if iid in item_map]

    if not items_to_write:
        log.warning("BriefingWriterAgent: no items selected to write")
        ctx.log_error("BriefingWriterAgent", "No items to write")
        return ctx

    skill = NarrativeSkill()

    try:
        profile_summary      = _build_profile_summary(ctx.user.profile, ctx.user.topic_clusters)
        behavioral_fp_text   = ctx.behavioral_fingerprint_text or "No behavioral data yet."
        recent_context       = _build_recent_context(ctx.user.recent_digest_items)
        story_threads_text   = _build_story_threads_summary(ctx.user.active_story_threads)
        # Cap memory_connections to prevent huge prompts (keep top 10 items max)
        memory_connections_capped = dict(list(ctx.memory_connections.items())[:10])
        memory_json = json.dumps(memory_connections_capped, indent=2)

        # Stable prefix — changes only when profile/fingerprint changes.
        # Anthropic caches this across retries and same-day re-runs.
        cached_prefix = skill.build_cached_prefix(
            profile_summary=profile_summary,
            behavioral_fingerprint_text=behavioral_fp_text,
            recent_context=recent_context,
            story_threads_text=story_threads_text,
            memory_json=memory_json,
        )
        cached_prefix += skill.build_style_block(
            brief_style=ctx.user.profile.get("brief_style", "analyst"),
            brief_language=ctx.user.profile.get("brief_language", "en"),
        )
        cached_prefix += _build_calendar_section(getattr(ctx, "calendar_briefing", None))
        cached_prefix += _build_wrapped_section(getattr(ctx, "wrapped_snapshot", None))

        # Variable section — items + pre-computed enrichment
        brief_language = (ctx.user.profile.get("brief_language") or "en").strip().lower()
        brief_style = (ctx.user.profile.get("brief_style") or "analyst").strip().lower()
        log.info(
            "BriefingWriterAgent: brief_style=%s brief_language=%s",
            brief_style,
            brief_language,
        )
        items_section = skill.build_items_section(
            items=items_to_write,
            enrichment_cache=ctx.enrichment_cache,
            ctx=ctx,
            brief_style=brief_style,
            brief_language=brief_language,
        )

        from briefly_api.config import get_settings
        writer_model = None
        if getattr(ctx.user, "is_pro", False):
            writer_model = get_settings().pro_writer_model

        proactive_section = _build_proactive_section(ctx.proactive_events or [])
        blind_spot_section = _build_blind_spot_section(getattr(ctx, "blind_spots", None) or [])
        items_with_proactive = items_section + proactive_section + blind_spot_section

        result = await skill.run(
            cached_prefix=cached_prefix,
            items_section=items_with_proactive,
            model=writer_model,
        )

        if result and result.get("items"):
            ctx.subject_line = result.get("subject_line", f"Your Briefly for {ctx.run_date}")
            ctx.preview_text = result.get("preview_text", "")
            skipped_note = result.get("skipped_note", "")
            if skipped_note:
                ctx.__dict__["skipped_note"] = skipped_note

            written_by_id = {w.get("content_id"): w for w in result.get("items", [])}
            drafts = _drafts_from_llm(items_to_write, written_by_id, ctx)
            drafts = _ensure_personalized_why(drafts, items_to_write, ctx.user.profile)
            _attach_score_breakdowns(drafts, items_to_write)
        else:
            ctx.subject_line = f"Your briefing — {ctx.run_date}"
            ctx.preview_text = items_to_write[0].title[:120] if items_to_write else ""
            drafts = _fallback_drafts(items_to_write, ctx)
            drafts = _ensure_personalized_why(drafts, items_to_write, ctx.user.profile)
            _attach_score_breakdowns(drafts, items_to_write)

    except Exception as e:
        log.exception("BriefingWriterAgent: failed — using fallback drafts")
        ctx.log_error("BriefingWriterAgent", str(e))
        ctx.subject_line = f"Your briefing — {ctx.run_date}"
        ctx.preview_text = items_to_write[0].title[:120] if items_to_write else ""
        drafts = _fallback_drafts(items_to_write, ctx)
        drafts = _ensure_personalized_why(drafts, items_to_write, ctx.user.profile)
        _attach_score_breakdowns(drafts, items_to_write)

    ctx.digest_items = drafts
    ctx.total_shown = len(drafts)

    enrichment_hit_count = sum(
        1 for i in items_to_write if ctx.enrichment_cache.get(i.id)
    )
    log.info(
        "BriefingWriterAgent: wrote %d items (enrichment_cache_hits=%d/%d) subject='%s'",
        len(drafts), enrichment_hit_count, len(items_to_write), ctx.subject_line[:60],
    )
    return ctx


def _assigned_section(item: RawItem) -> str:
    return item.meta.get("digest_section") or SECTION_WHATS_NEW


def _draft_url(item: RawItem, written_url: str | None = None) -> str | None:
    for candidate in (written_url, item.url):
        resolved = resolve_article_url(candidate, item.meta)
        if resolved:
            return resolved
    return None


def _fallback_drafts(items: list[RawItem], ctx: PipelineContext) -> list[DigestItemDraft]:
    drafts: list[DigestItemDraft] = []
    for pos, item in enumerate(items, start=1):
        summary = item.summary or item.clean_text[:300]
        drafts.append(
            DigestItemDraft(
                content_id=item.id,
                position=pos,
                section=_assigned_section(item),
                headline=item.title,
                summary=summary,
                why_it_matters=_personalized_why_fallback(item, ctx.user.profile),
                source_name=item.source_name,
                source_url=_draft_url(item),
                all_sources=item.duplicate_sources,
                duplicate_count=len(item.duplicate_sources) + 1,
                memory_connections=ctx.memory_connections.get(item.id, []),
                relevance_score=item.relevance_score,
                novelty_score=item.novelty_score,
                score_breakdown=dict(item.score_breakdown or {}),
                memory_reference=_fallback_memory_reference(item, ctx.memory_connections),
                confidence_signal=_fallback_confidence_signal(item, ctx.user.profile),
            )
        )
        cached = ctx.enrichment_cache.get(item.id, {})
        if cached.get("contradiction_flag"):
            drafts[-1].contradiction_flag = True
            drafts[-1].contradiction_explanation = cached.get("contradiction_explanation") or ""
    return drafts


def build_fallback_drafts(ctx: PipelineContext) -> list[DigestItemDraft]:
    """Public fallback used by the pipeline when the writer returns no items."""
    selected_ids = set(ctx.selected_item_ids)
    items = [i for i in ctx.enriched_items if i.id in selected_ids]
    if not items:
        item_map = {i.id: i for i in ctx.enriched_items}
        items = [item_map[iid] for iid in ctx.selected_item_ids if iid in item_map]
    return _fallback_drafts(items, ctx)


def _profile_anchor_terms(profile: dict) -> set[str]:
    terms: set[str] = set()
    role = (profile.get("role") or "").strip().lower()
    goal = (profile.get("goal") or "").strip().lower()
    if role:
        terms.add(role)
        terms.update(w for w in role.split() if len(w) > 3)
    if goal:
        terms.update(w for w in goal.split() if len(w) > 4)
    for interest in profile.get("interests") or []:
        topic = (interest.get("topic") or "").strip().lower()
        if topic:
            terms.add(topic)
    for cluster in profile.get("topic_clusters") or []:
        label = cluster_label(cluster)
        if label:
            terms.add(label.lower())
    return terms


def _has_devanagari(text: str) -> bool:
    return any("\u0900" <= ch <= "\u097F" for ch in (text or ""))


def _why_is_personalized(text: str, profile: dict) -> bool:
    if not text or len(text.strip()) < 24:
        return False
    if (profile.get("brief_language") or "en") == "hi" and _has_devanagari(text):
        return True
    lower = text.lower()
    generic = (
        "worth a read",
        "one of your sources",
        "in your briefing today",
        "worth scanning before your day gets busy",
        "ties directly to startup",
    )
    if any(g in lower for g in generic):
        return False
    anchors = _profile_anchor_terms(profile)
    if anchors and any(a in lower for a in anchors):
        return True
    # Accept if it references role/goal explicitly
    role = (profile.get("role") or "").strip().lower()
    goal = (profile.get("goal") or "").strip().lower()
    if role and role in lower:
        return True
    if goal and any(w in lower for w in goal.split() if len(w) > 4):
        return True
    return len(text.split()) >= 12


def _personalized_why_fallback(item: RawItem, profile: dict) -> str:
    role = profile.get("role") or "your role"
    interests = [
        (i.get("topic") or "").strip()
        for i in (profile.get("interests") or [])
        if i.get("topic")
    ]
    blob = f"{item.title} {item.summary or item.clean_text[:600]}".lower()
    matched = [t for t in interests if t.lower() in blob]
    if not matched:
        for t in interests:
            for word in t.lower().split():
                if len(word) > 4 and word in blob:
                    matched.append(t)
                    break

    if matched:
        topics = ", ".join(matched[:2])
        return (
            f"As a {role}, this {item.source_name} piece lines up with your interests "
            f"in {topics}."
        )
    if interests:
        return (
            f"From {item.source_name} — one of your subscribed sources. "
            f"It didn't strongly match {interests[0]}, but it's the latest from that feed."
        )
    return (
        f"Latest from {item.source_name}, which you added to your briefing sources."
    )


def _fallback_memory_reference(item: RawItem, memory_connections: dict) -> str:
    """Build a plain-language memory reference when the LLM isn't available."""
    connections = memory_connections.get(item.id, [])
    if not connections:
        return ""
    c = connections[0]
    thread_key = c.get("thread_key", "")
    occ = c.get("occurrence_count", 1)
    if thread_key:
        weeks = max(1, round(occ / 3))
        return f"You've been following this story for {weeks}+ week{'s' if weeks > 1 else ''}."
    return ""


def _fallback_confidence_signal(item: RawItem, profile: dict) -> str:
    """Build a relevance confidence note when the LLM isn't available."""
    score = item.relevance_score or 0.0
    if score >= 0.85:
        return "Very high relevance to your profile."
    if score >= 0.70:
        return "Strong match to your interests."
    return ""


def _ensure_personalized_why(
    drafts: list[DigestItemDraft],
    items: list[RawItem],
    profile: dict,
) -> list[DigestItemDraft]:
    # Hindi briefs: never replace writer output with English fallback copy.
    if (profile.get("brief_language") or "en") == "hi":
        return drafts
    item_by_id = {i.id: i for i in items}
    for draft in drafts:
        if _why_is_personalized(draft.why_it_matters, profile):
            continue
        source_item = item_by_id.get(draft.content_id) or next(
            (i for i in items if i.title == draft.headline), None,
        )
        if source_item:
            draft.why_it_matters = _personalized_why_fallback(source_item, profile)
    return drafts


def _attach_score_breakdowns(
    drafts: list[DigestItemDraft],
    items: list[RawItem],
) -> None:
    by_id = {item.id: item for item in items}
    for draft in drafts:
        source = by_id.get(draft.content_id or "")
        if source and source.score_breakdown:
            draft.score_breakdown = dict(source.score_breakdown)


def _drafts_from_llm(
    items_to_write: list[RawItem],
    written_by_id: dict,
    ctx: PipelineContext,
) -> list[DigestItemDraft]:
    item_map = {i.id: i for i in items_to_write}
    drafts: list[DigestItemDraft] = []

    for pos, item in enumerate(items_to_write, start=1):
        written = written_by_id.get(item.id, {})
        source_item = item_map.get(item.id)
        assigned = _assigned_section(item)

        draft = DigestItemDraft(
            content_id=item.id,
            position=pos,
            section=written.get("section") or assigned,
            headline=written.get("headline") or item.title,
            summary=written.get("summary") or (item.summary or item.clean_text[:300]),
            why_it_matters=written.get(
                "why_it_matters_to_you",
                f"From {item.source_name}, in your briefing today.",
            ),
            source_name=written.get("source_name", source_item.source_name if source_item else item.source_name),
            source_url=_draft_url(source_item or item, written.get("source_url")),
            all_sources=source_item.duplicate_sources if source_item else [],
            duplicate_count=len(source_item.duplicate_sources) + 1 if source_item else 1,
            memory_connections=ctx.memory_connections.get(item.id, []),
            relevance_score=source_item.relevance_score if source_item else 0.0,
            novelty_score=source_item.novelty_score if source_item else 0.5,
            score_breakdown=dict(source_item.score_breakdown or {}) if source_item else {},
            memory_reference=written.get("memory_reference", ""),
            confidence_signal=written.get("confidence_signal", ""),
            evolution_note=written.get("evolution_note", ""),
        )
        cached = ctx.enrichment_cache.get(item.id, {})
        if cached.get("contradiction_flag"):
            draft.contradiction_flag = True
            draft.contradiction_explanation = (
                cached.get("contradiction_explanation") or written.get("contradiction_explanation") or ""
            )
        if draft.section not in (SECTION_WHATS_NEW, SECTION_HIGHLY_RELEVANT):
            draft.section = assigned
        drafts.append(draft)

    return drafts


# ── Legacy block removed — drafts built above ─────────────────────────────────


# ── Context builders ──────────────────────────────────────────────────────────

def _build_calendar_section(calendar_briefing: dict | None) -> str:
    if not calendar_briefing or not calendar_briefing.get("meetings"):
        return ""
    lines = [
        "\n## Today's meetings (elevate stories relevant to these)\n",
        calendar_briefing.get("summary_text", ""),
        "\nWhen a digest item clearly prepares the user for a listed meeting, "
        "say so in why_it_matters_to_you (e.g. 'Relevant before your 2pm with …').\n",
    ]
    return "\n".join(lines)


def _build_wrapped_section(wrapped: dict | None) -> str:
    if not wrapped:
        return ""
    parts = ["\n## Weekly intelligence (surface lightly in subject or preview if Monday)\n"]
    if wrapped.get("current_focus"):
        parts.append(f"Current focus: {wrapped['current_focus']}")
    for shift in (wrapped.get("mind_shifts") or [])[:2]:
        parts.append(
            f"Mind shift — {shift.get('topic', '')}: {shift.get('direction', '')} ({shift.get('evidence', '')})"
        )
    if wrapped.get("weekly_synthesis"):
        parts.append(f"Weekly synthesis: {wrapped['weekly_synthesis'][:400]}")
    parts.append(
        "Do not add a separate Wrapped section to the digest — weave one insight into preview_text if natural.\n"
    )
    return "\n".join(parts) + "\n"


def _build_blind_spot_section(blind_spots: list[dict]) -> str:
    if not blind_spots:
        return ""
    lines = ["\n## Blind spots — contrarian angles the user may be missing\n"]
    for spot in blind_spots:
        lines.append(f"- Topic: {spot.get('topic', '')}")
        lines.append(f"  Consensus: {spot.get('consensus', '')}")
        if spot.get("counter_argument"):
            lines.append(f"  Counter: {spot.get('counter_argument', '')}")
    lines.append(
        "\nIf a blind spot matches a digest item, mention the tension in why_it_matters_to_you. "
        "Do not invent counter-arguments not listed above.\n"
    )
    return "\n".join(lines)


def _build_proactive_section(events: list[dict]) -> str:
    if not events:
        return ""
    lines = ["\n## Proactive alerts to weave into the brief (elevate these threads)\n"]
    for ev in events:
        lines.append(
            f"- [{ev.get('event_type')}] {ev.get('title')}: {ev.get('body')}"
        )
    lines.append(
        "\nIf a digest item matches a proactive alert, mention the thread update "
        "in memory_reference or why_it_matters_to_you.\n"
    )
    return "\n".join(lines)


def _build_profile_summary(profile: dict, topic_clusters: list[dict]) -> str:
    parts = []
    if profile.get("role"):
        parts.append(f"Role: {profile['role']}")
    if profile.get("goal"):
        parts.append(f"Goal: {profile['goal']}")
    if profile.get("recent_insight"):
        parts.append(f"Depth of thinking they value (a recent insight that shaped them): {profile['recent_insight'][:250]}")
    interests = profile.get("interests", [])
    if interests:
        topics = ", ".join(i.get("topic", "") for i in interests[:8] if i.get("topic"))
        parts.append(f"Declared interests: {topics}")
    if topic_clusters:
        cluster_parts: list[str] = []
        for c in sorted(topic_clusters, key=lambda x: x.get("strength", 0), reverse=True):
            label = cluster_label(c)
            if not label:
                continue
            strength = c.get("strength", c.get("weight"))
            if isinstance(strength, (int, float)) and strength > 0:
                cluster_parts.append(f"{label} (strength {strength:.0%})")
            else:
                cluster_parts.append(label)
            if len(cluster_parts) >= 5:
                break
        if cluster_parts:
            parts.append(f"Inferred topics (from reading behaviour): {', '.join(cluster_parts)}")
    if profile.get("never_show"):
        never = ", ".join(profile["never_show"][:5])
        parts.append(f"Never show: {never}")
    if profile.get("changed_mind_about"):
        parts.append(f"Recently changed mind about: {profile['changed_mind_about'][:150]}")
    return "\n".join(parts)


def _build_recent_context(recent_items: list[dict]) -> str:
    if not recent_items:
        return "No previous digest history yet — this is their first digest."
    summaries = []
    for item in recent_items[:5]:  # 5 is enough context; 10 added ~200 unnecessary tokens
        date = item.get("digest_date", "")
        headline = item.get("headline", "")
        if headline:
            summaries.append(f"- [{date}] {headline}")
    return "\n".join(summaries) if summaries else "No recent items."


def _build_story_threads_summary(threads: list[dict]) -> str:
    """Summarise active story threads for the writer prompt."""
    if not threads:
        return "No active story threads yet."
    parts = []
    for t in threads[:10]:
        key = t.get("key", "")
        occ = t.get("occurrence_count", 1)
        value = t.get("value") or {}
        first_seen = value.get("first_seen", "")
        latest = value.get("latest_headline", "")
        parts.append(f"- '{key}' (appeared {occ}x since {first_seen}, latest: {latest[:80]})")
    return "\n".join(parts)


def _build_items_json(items: list[RawItem], ctx: PipelineContext) -> str:
    slim = []
    for item in items:
        # Prefer the structured summary; fall back to a short clean_text excerpt.
        # 200 chars is enough context for the writer — trimming from 400 reduces
        # input tokens by ~30% without losing meaningful signal.
        body = item.summary or (item.clean_text[:200] if item.clean_text else "")
        slim.append({
            "id": item.id,
            "digest_section": _assigned_section(item),
            "title": item.title,
            "source": item.source_name,
            "source_type": item.source_type,
            "url": item.url,
            "summary": body,
            "relevance_score": round(item.relevance_score, 2),
            "novelty_score": round(item.novelty_score, 2),
            "duplicate_sources": item.duplicate_sources,
            "published_at": item.published_at.isoformat() if item.published_at else None,
        })
    return json.dumps(slim, indent=2)


def _suggest_sections(profile: dict, topic_clusters: list[dict]) -> list[str]:
    """
    Suggest section names personalised to the user's interests.
    A founder sees "Startup & Funding" not "Business News".
    """
    role = (profile.get("role") or "").lower()
    interests = profile.get("interests", [])
    interest_topics = [i.get("topic", "").lower() for i in interests]

    sections = []

    # Role-based sections
    if "founder" in role or "startup" in role:
        sections.extend(["Startup & Funding", "Product & Growth"])
    elif "investor" in role or "vc" in role:
        sections.extend(["Deals & Funding", "Market Moves"])
    elif "engineer" in role or "developer" in role:
        sections.extend(["Engineering & Tools", "Open Source"])
    elif "product" in role:
        sections.extend(["Product & Design", "User Research"])
    else:
        sections.extend(["Today's Highlights"])

    # Interest-based sections
    if any("ai" in t or "machine learning" in t or "llm" in t for t in interest_topics):
        sections.append("AI & Models")
    if any("india" in t for t in interest_topics):
        sections.append("India Tech")
    if any("crypto" in t or "web3" in t for t in interest_topics):
        sections.append("Web3 & Crypto")
    if any("climate" in t or "sustainability" in t for t in interest_topics):
        sections.append("Climate & Energy")

    # Always include a catch-all
    sections.append("Worth Reading")

    # Deduplicate and limit
    seen = set()
    result = []
    for s in sections:
        if s not in seen:
            seen.add(s)
            result.append(s)

    return result[:5]  # max 5 sections
