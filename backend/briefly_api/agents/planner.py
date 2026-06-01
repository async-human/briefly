"""
briefly_api/agents/planner.py

BriefingPlannerAgent: dual-pool selection + section assignment.

Pool A — What's new: newest item per source (freshness guarantee).
Pool B — Highly relevant to you: high-scoring items from the wider fetch window.
Backfill — remaining slots by combined relevance + novelty score.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from briefly_api.agents.context import PipelineContext, RawItem
from briefly_api.config import get_settings
from briefly_api.services.digest_sections import (
    SECTION_HIGHLY_RELEVANT,
    SECTION_WHATS_NEW,
)

log = logging.getLogger(__name__)

_MAX_PER_SOURCE = 3


def _freshness_key(item: RawItem) -> tuple:
    published = item.published_at
    if published and published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    rank = item.meta.get("fetch_rank", 999)
    return (
        published or datetime.min.replace(tzinfo=timezone.utc),
        -rank,
    )


def _age_days(item: RawItem) -> float | None:
    if not item.published_at:
        return None
    published = item.published_at
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - published).total_seconds() / 86400


def _within_rescue_window(item: RawItem, max_age_days: int) -> bool:
    age = _age_days(item)
    if age is None:
        return True
    return age <= max_age_days


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Select items via dual-pool strategy and assign digest sections.
    Populates ctx.selected_item_ids and ctx.planned_sections.
    """
    s = get_settings()
    items = ctx.enriched_items

    if not items:
        log.warning("BriefingPlannerAgent: no enriched items to plan")
        return ctx

    def combined_score(item: RawItem) -> float:
        return 0.55 * item.relevance_score + 0.25 * item.novelty_score + 0.20 * _recency_component(item)

    def _recency_component(item: RawItem) -> float:
        age = _age_days(item)
        if age is None:
            return 0.5
        if age < 1:
            return 1.0
        if age < 3:
            return 0.85
        if age < 7:
            return 0.65
        if age < 14:
            return 0.45
        return 0.25

    selected: list[RawItem] = []
    selected_ids: set[str] = set()
    source_counts: dict[str, int] = defaultdict(int)

    def _select(item: RawItem, section: str, pool: str) -> None:
        if item.id in selected_ids:
            return
        item.meta["digest_section"] = section
        item.meta["digest_pool"] = pool
        selected.append(item)
        selected_ids.add(item.id)
        source_counts[item.source_id] += 1

    by_source: dict[str, list[RawItem]] = defaultdict(list)
    for item in items:
        by_source[item.source_id].append(item)

    for group in by_source.values():
        group.sort(key=_freshness_key, reverse=True)

    # Pool A — one newest item per source (freshness), if relevant enough
    for group in by_source.values():
        if len(selected) >= s.digest_max_items:
            break
        candidate = group[0]
        if candidate.relevance_score < s.freshness_min_relevance:
            continue
        _select(candidate, SECTION_WHATS_NEW, "fresh")

    # Pool B — highly relevant rescues from the remainder
    rescue_candidates = [
        i for i in items
        if i.id not in selected_ids
        and i.relevance_score >= s.relevance_rescue_threshold
        and _within_rescue_window(i, s.relevance_rescue_max_age_days)
    ]
    rescue_candidates.sort(key=lambda i: i.relevance_score, reverse=True)

    for item in rescue_candidates:
        if len(selected) >= s.digest_max_items:
            break
        if source_counts[item.source_id] >= _MAX_PER_SOURCE:
            continue
        _select(item, SECTION_HIGHLY_RELEVANT, "relevant")

    # Backfill — best combined score among what's left
    if len(selected) < s.digest_min_items or len(selected) < s.digest_max_items:
        remaining = sorted(
            [i for i in items if i.id not in selected_ids],
            key=combined_score,
            reverse=True,
        )
        for item in remaining:
            if len(selected) >= s.digest_max_items:
                break
            if source_counts[item.source_id] >= _MAX_PER_SOURCE:
                continue
            section = (
                SECTION_HIGHLY_RELEVANT
                if item.relevance_score >= s.relevance_threshold
                else SECTION_WHATS_NEW
            )
            _select(item, section, "backfill")

    # Order: What's new first, then Highly relevant
    fresh_items = [i for i in selected if i.meta.get("digest_pool") == "fresh"]
    relevant_items = [i for i in selected if i.meta.get("digest_pool") == "relevant"]
    backfill_whats_new = [
        i for i in selected
        if i.meta.get("digest_pool") == "backfill" and i.meta.get("digest_section") == SECTION_WHATS_NEW
    ]
    backfill_relevant = [
        i for i in selected
        if i.meta.get("digest_pool") == "backfill" and i.meta.get("digest_section") == SECTION_HIGHLY_RELEVANT
    ]

    fresh_items.sort(key=_freshness_key, reverse=True)
    relevant_items.sort(key=lambda i: i.relevance_score, reverse=True)
    backfill_whats_new.sort(key=combined_score, reverse=True)
    backfill_relevant.sort(key=combined_score, reverse=True)

    ordered = fresh_items + backfill_whats_new + relevant_items + backfill_relevant
    ctx.selected_item_ids = [i.id for i in ordered]

    ctx.planned_sections = []
    whats_new_ids = [i.id for i in ordered if i.meta.get("digest_section") == SECTION_WHATS_NEW]
    relevant_ids = [i.id for i in ordered if i.meta.get("digest_section") == SECTION_HIGHLY_RELEVANT]
    if whats_new_ids:
        ctx.planned_sections.append({"name": SECTION_WHATS_NEW, "item_ids": whats_new_ids})
    if relevant_ids:
        ctx.planned_sections.append({"name": SECTION_HIGHLY_RELEVANT, "item_ids": relevant_ids})

    selected_id_set = set(ctx.selected_item_ids)
    for item in items:
        if item.id not in selected_id_set:
            item.drop_reason = "crowded_out"
    ctx.crowded_out_items = [i for i in items if i.id not in selected_id_set]

    log.info(
        "BriefingPlannerAgent: selected %d (fresh=%d relevant=%d backfill=%d, crowded_out=%d)",
        len(ordered),
        len(fresh_items),
        len(relevant_items),
        len(backfill_whats_new) + len(backfill_relevant),
        len(ctx.crowded_out_items),
    )
    return ctx
