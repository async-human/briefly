"""
briefly_api/agents/learning.py

LearningAgent: updates user profile counters and infers topic clusters
from what was included in this digest.

Runs synchronously after delivery (as noted in pipeline.py). Failures
here never block the digest from being delivered.
"""
from __future__ import annotations

import logging

from sqlalchemy import update

from briefly_api.agents.context import PipelineContext
from briefly_api.db.models import UserProfile

log = logging.getLogger(__name__)


async def run(ctx: PipelineContext) -> PipelineContext:
    """Update user profile with post-digest learning signals."""
    session = ctx.db_session
    if not session:
        log.warning("LearningAgent: no DB session available — skipping")
        return ctx

    if not ctx.digest_items:
        return ctx

    try:
        # Increment total_digests_received
        await session.execute(
            update(UserProfile)
            .where(UserProfile.user_id == ctx.user.user_id)
            .values(
                total_digests_received=UserProfile.total_digests_received + 1,
            )
        )

        # Infer topic clusters from included items' sources and keywords
        _update_topic_clusters(ctx)

        await session.flush()

    except Exception as e:
        log.exception("LearningAgent: failed to update profile: %s", e)
        ctx.log_error("LearningAgent", str(e))

    log.info("LearningAgent: updated profile for user %s", ctx.user.user_id)
    return ctx


def _update_topic_clusters(ctx: PipelineContext) -> None:
    """
    Lightweight cluster update: increment occurrence_count for sections
    seen in this digest. Full cluster inference happens in a future version
    via behavioral signals (opens, clicks).
    """
    section_counts: dict[str, int] = {}
    for item in ctx.digest_items:
        section = item.section or "General"
        section_counts[section] = section_counts.get(section, 0) + 1

    existing = {c.get("cluster"): c for c in (ctx.user.profile.get("topic_clusters") or [])}
    for section, count in section_counts.items():
        if section in existing:
            existing[section]["item_count"] = existing[section].get("item_count", 0) + count
        # New clusters are added by a more thorough inference step elsewhere
