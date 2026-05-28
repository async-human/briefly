"""
briefly_api/agents/planner.py

BriefingPlannerAgent: selects which items to include in the digest
and organizes them into sections.

Selection criteria (in priority order):
  1. Never exceed digest_max_items
  2. Prefer high relevance + high novelty items
  3. Ensure source diversity (cap items per source)
  4. Always aim for at least digest_min_items if pool allows
"""
from __future__ import annotations

import logging
from collections import defaultdict

from briefly_api.agents.context import PipelineContext
from briefly_api.config import get_settings

log = logging.getLogger(__name__)

# Max items from any single source
_MAX_PER_SOURCE = 3


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Select and order items for the digest.
    Populates ctx.selected_item_ids and ctx.planned_sections.
    """
    s = get_settings()
    items = ctx.enriched_items

    if not items:
        log.warning("BriefingPlannerAgent: no enriched items to plan")
        return ctx

    # Composite score: weighted combination of relevance and novelty
    def combined_score(item) -> float:
        return 0.7 * item.relevance_score + 0.3 * item.novelty_score

    ranked = sorted(items, key=combined_score, reverse=True)

    # Greedy selection with per-source cap
    selected = []
    source_counts: dict[str, int] = defaultdict(int)

    for item in ranked:
        if len(selected) >= s.digest_max_items:
            break
        if source_counts[item.source_id] >= _MAX_PER_SOURCE:
            continue
        selected.append(item)
        source_counts[item.source_id] += 1

    # If still under min, relax source cap and backfill
    if len(selected) < s.digest_min_items:
        remaining = [i for i in ranked if i not in selected]
        for item in remaining:
            if len(selected) >= s.digest_min_items:
                break
            selected.append(item)

    ctx.selected_item_ids = [i.id for i in selected]

    log.info(
        "BriefingPlannerAgent: selected %d items from pool of %d",
        len(selected), len(items),
    )
    return ctx
