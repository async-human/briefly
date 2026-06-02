"""Compute outcome-native metadata for delivered briefings."""
from __future__ import annotations

from briefly_api.agents.context import DigestItemDraft, PipelineContext


def build_outcome_meta(ctx: PipelineContext) -> dict:
    """
    Build proof-of-value metrics shown in UI and email.
    """
    dropped = list(getattr(ctx, "dropped_items", []) or [])
    crowded = list(getattr(ctx, "crowded_out_items", []) or [])
    filtered_count = max(0, ctx.total_ingested - len(ctx.digest_items)) + len(dropped) + len(crowded)

    drafts = list(ctx.digest_items or [])
    sorted_drafts = sorted(
        drafts,
        key=lambda d: (d.relevance_score, d.novelty_score),
        reverse=True,
    )
    top_priority_content_ids = [d.content_id for d in sorted_drafts[:3] if d.content_id]

    # Estimate reading time saved vs reading full sources (~4 min/item filtered, ~2 min/item summarized)
    saved_minutes = max(5, filtered_count * 4 + len(drafts) * 2)

    profile = ctx.user.profile or {}
    interests = [str(i).strip() for i in (profile.get("interests") or []) if i][:3]
    goal = str(profile.get("goal") or "").strip()

    skipped_note = str(ctx.__dict__.get("skipped_note") or "").strip()
    if not skipped_note and filtered_count > 0:
        skipped_note = (
            f"Briefly filtered {filtered_count} items — mostly duplicates, low relevance, "
            f"or topics you've deprioritized. You're not missing anything in your priority areas."
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
    }
