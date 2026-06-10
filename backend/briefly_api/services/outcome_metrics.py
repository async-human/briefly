"""Compute outcome-native metadata for delivered briefings."""
from __future__ import annotations

from briefly_api.agents.context import PipelineContext
from briefly_api.services.personalization_score import pick_top_priority_content_ids

_WORDS_PER_MINUTE = 220


def _word_count(text: str) -> int:
    return len((text or "").split())


def build_outcome_meta(ctx: PipelineContext) -> dict:
    """
    Build proof-of-value metrics shown in UI and email.

    saved_minutes is based on word counts from ingested source material —
    honest framing: time it would take to read everything Briefly scanned.
    """
    dropped = list(getattr(ctx, "dropped_items", []) or [])
    crowded = list(getattr(ctx, "crowded_out_items", []) or [])
    filtered_count = max(0, ctx.total_ingested - len(ctx.digest_items)) + len(dropped) + len(crowded)

    drafts = list(ctx.digest_items or [])
    top_priority_content_ids = pick_top_priority_content_ids(
        drafts,
        enriched_items=list(ctx.enriched_items or []),
        profile=ctx.user.profile or {},
        topic_clusters=ctx.user.topic_clusters,
        sources=ctx.user.sources or [],
        memory_connections=getattr(ctx, "memory_connections", None),
    )

    shown_ids = {d.content_id for d in drafts if d.content_id}
    words_scanned = 0
    for item in ctx.raw_items or []:
        words_scanned += _word_count(item.clean_text or item.title or "")

    brief_words = sum(
        _word_count(f"{d.headline} {d.summary} {d.why_it_matters}")
        for d in drafts
    )

    # Time to read full sources vs. the distilled brief
    full_read_minutes = words_scanned / _WORDS_PER_MINUTE
    brief_read_minutes = brief_words / _WORDS_PER_MINUTE
    saved_minutes = max(1, round(full_read_minutes - brief_read_minutes))

    profile = ctx.user.profile or {}
    raw_interests = profile.get("interests") or []
    interests: list[str] = []
    for i in raw_interests:
        if isinstance(i, dict):
            topic = (i.get("topic") or "").strip()
        else:
            topic = str(i).strip()
        if topic:
            interests.append(topic)
    interests = interests[:3]
    goal = str(profile.get("goal") or "").strip()

    skipped_note = str(ctx.__dict__.get("skipped_note") or "").strip()
    if not skipped_note and filtered_count > 0:
        skipped_note = (
            f"Briefly read {ctx.total_ingested} stories and showed {len(drafts)} — "
            f"filtered {filtered_count} you can safely skip today."
        )

    return {
        "saved_minutes": saved_minutes,
        "filtered_count": filtered_count,
        "top_priority_content_ids": top_priority_content_ids,
        "catch_up_topics": interests,
        "goal": goal[:200] if goal else None,
        "skipped_note": skipped_note,
        "items_shown": len(drafts),
        "items_scanned": ctx.total_ingested,
        "words_scanned": words_scanned,
    }
