"""
briefly_api/agents/novelty.py

NoveltyAgent: scores each item for how new it is to this user
(distinct from recency — novelty measures "have they seen this story before").

Items already in seen_content_hashes got a pre-penalty in DeduplicationAgent.
Here we also boost items with no seen_hash match (genuinely new stories).
After scoring, moves scored_items → enriched_items so subsequent agents
can work from the fully enriched pool.
"""
from __future__ import annotations

import logging

from briefly_api.agents.context import PipelineContext

log = logging.getLogger(__name__)


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Assign novelty scores to all scored items and move them to enriched_items.
    """
    seen = ctx.user.seen_content_hashes

    for item in ctx.scored_items:
        # Dedup agent may have already set novelty_score to 0.1 for seen items
        if item.novelty_score < 1.0:
            continue  # already penalized

        if item.content_hash and item.content_hash in seen:
            item.novelty_score = 0.1
        else:
            item.novelty_score = 1.0

    # Promote scored → enriched so the planner/writer work from this list
    ctx.enriched_items = ctx.scored_items

    log.info(
        "NoveltyAgent: %d items enriched (%d seen-again)",
        len(ctx.enriched_items),
        sum(1 for i in ctx.enriched_items if i.novelty_score < 0.5),
    )
    return ctx
