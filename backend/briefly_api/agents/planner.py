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

from briefly_api.services.source_priority import (
    build_priority_map,
    max_items_for_source,
    priority_sort_key,
)

log = logging.getLogger(__name__)


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


def _within_briefing_age(item: RawItem, max_days: int) -> bool:
    age = _age_days(item)
    if age is None:
        return True
    return age <= max_days


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Select items via dual-pool strategy and assign digest sections.
    Populates ctx.selected_item_ids and ctx.planned_sections.
    """
    s = get_settings()
    items = ctx.enriched_items
    priority_map = build_priority_map(ctx.user.sources or [])

    if not items:
        log.warning("BriefingPlannerAgent: no enriched items to plan")
        return ctx

    def combined_score(item: RawItem) -> float:
        base = 0.55 * item.relevance_score + 0.25 * item.novelty_score + 0.20 * _recency_component(item)
        # Slight boost so starred sources win tie-breakers in backfill
        if priority_sort_key(item.source_id, priority_map) == 0:
            base += 0.04
        return base

    def _source_at_cap(source_id: str) -> bool:
        return source_counts[source_id] >= max_items_for_source(source_id, priority_map)

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

    max_age = s.relevance_rescue_max_age_days

    def _select(item: RawItem, section: str, pool: str) -> None:
        if item.id in selected_ids:
            return
        if not _within_briefing_age(item, max_age):
            item.drop_reason = "too_old"
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

    # Pool A — newest item per source; high-priority sources fill slots first
    pool_a_sources = sorted(
        by_source.items(),
        key=lambda pair: priority_sort_key(pair[0], priority_map),
    )
    for source_id, group in pool_a_sources:
        if len(selected) >= s.digest_max_items:
            break
        candidate = group[0]
        min_rel = s.freshness_min_relevance
        if priority_sort_key(source_id, priority_map) == 0:
            min_rel = max(min_rel, 0.42)
        if candidate.relevance_score < min_rel:
            continue
        _select(candidate, SECTION_WHATS_NEW, "fresh")

    # Pool A+ — extra slots for high-priority sources (2nd–3rd newest)
    for source_id, group in pool_a_sources:
        if priority_sort_key(source_id, priority_map) != 0:
            continue
        for candidate in group[1:3]:
            if len(selected) >= s.digest_max_items:
                break
            if _source_at_cap(source_id):
                break
            min_rel = s.freshness_min_relevance
            if priority_sort_key(source_id, priority_map) == 0:
                min_rel = max(min_rel, 0.42)
            if candidate.relevance_score < min_rel:
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
        if source_counts[item.source_id] >= max_items_for_source(item.source_id, priority_map):
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
            if _source_at_cap(item.source_id):
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

    def _priority_freshness(item: RawItem) -> tuple:
        fk = _freshness_key(item)
        ts = fk[0].timestamp() if fk[0] != datetime.min.replace(tzinfo=timezone.utc) else 0.0
        return (priority_sort_key(item.source_id, priority_map), -ts, fk[1])

    fresh_items.sort(key=_priority_freshness)
    relevant_items.sort(
        key=lambda i: (priority_sort_key(i.source_id, priority_map), -i.relevance_score),
    )
    backfill_whats_new.sort(
        key=lambda i: (priority_sort_key(i.source_id, priority_map), -combined_score(i)),
    )
    backfill_relevant.sort(
        key=lambda i: (priority_sort_key(i.source_id, priority_map), -combined_score(i)),
    )

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
