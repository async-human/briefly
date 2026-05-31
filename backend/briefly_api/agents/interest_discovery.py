"""
briefly_api/agents/interest_discovery.py

InterestDiscoveryAgent — closes the learning → discovery feedback loop.

Runs immediately after LearningAgent. Uses the signals LearningAgent
already collected (what the user clicked/saved) to infer which topics
are gaining weight, then queries the source catalog (+ Medium tag feeds)
for sources the user doesn't have yet. Suggestions are stored in
UserProfile.suggested_sources and surfaced in the dashboard sidebar.

Frequency guard: only refreshes suggestions every 3 digests so the UI
doesn't churn after every single delivery.
"""
from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from briefly_api.agents.context import PipelineContext
from briefly_api.db.models import BehavioralSignal, DigestItem, SignalType, UserProfile
from briefly_api.services.source_catalog import get_interest_driven_suggestions

log = logging.getLogger(__name__)

# Refresh suggestions every N digests to avoid churn
_REFRESH_EVERY_N = 3
# Max total suggestions to keep stored (older ones are evicted)
_MAX_STORED = 8
# Suggestions per refresh run
_SUGGEST_PER_RUN = 3
# Lookback for engagement signals
_SIGNAL_WINDOW_DAYS = 14


async def run(ctx: PipelineContext) -> PipelineContext:
    session = ctx.db_session
    if not session:
        return ctx

    total_received: int = ctx.user.profile.get("total_digests_received", 0) + 1
    # LearningAgent increments the counter just before this agent runs
    if total_received % _REFRESH_EVERY_N != 0:
        return ctx

    try:
        inferred = await _extract_inferred_topics(ctx, session)
        declared = [
            i.get("topic", "")
            for i in (ctx.user.profile.get("interests") or [])
            if i.get("topic")
        ]
        already_added = {
            s.identifier.lower()
            for s in (ctx.user.sources or [])
            if hasattr(s, "identifier") and s.identifier
        }
        existing_suggestions: list[dict] = ctx.user.profile.get("suggested_sources") or []

        new_suggestions = get_interest_driven_suggestions(
            inferred_topics=inferred,
            declared_interests=declared,
            already_added_urls=already_added,
            existing_suggestions=existing_suggestions,
            limit=_SUGGEST_PER_RUN,
        )

        if not new_suggestions:
            return ctx

        # Merge: prepend new, drop duplicates, cap total
        existing_urls = {s["url"] for s in existing_suggestions}
        fresh = [s for s in new_suggestions if s["url"] not in existing_urls]
        merged = (fresh + existing_suggestions)[:_MAX_STORED]

        await session.execute(
            update(UserProfile)
            .where(UserProfile.user_id == ctx.user.user_id)
            .values(suggested_sources=merged)
        )

        log.info(
            "InterestDiscoveryAgent: stored %d new suggestion(s) for user %s (topics: %s)",
            len(fresh), ctx.user.user_id, ", ".join(inferred[:4]),
        )

    except Exception:
        log.exception("InterestDiscoveryAgent: failed for user %s", ctx.user.user_id)
        ctx.log_error("InterestDiscoveryAgent", "Failed to compute suggestions")

    return ctx


async def _extract_inferred_topics(ctx: PipelineContext, session) -> list[str]:
    """
    Return a ranked list of inferred topic strings from two sources:
      1. Sections the user recently engaged with (click/save signals)
      2. High-weight topic_clusters already tracked in their profile
    """
    topics: Counter[str] = Counter()

    # Source A — section labels from engaged digest items in the past 14 days
    cutoff = datetime.now(timezone.utc) - timedelta(days=_SIGNAL_WINDOW_DAYS)
    result = await session.execute(
        select(DigestItem.section, DigestItem.headline)
        .join(BehavioralSignal, BehavioralSignal.digest_item_id == DigestItem.id)
        .where(
            BehavioralSignal.user_id == ctx.user.user_id,
            BehavioralSignal.signal_type.in_([
                SignalType.clicked,
                SignalType.saved,
                SignalType.followed_up,
            ]),
            BehavioralSignal.created_at >= cutoff,
        )
        .distinct()
    )
    rows = result.all()
    for row in rows:
        if row.section:
            topics[row.section.lower()] += 2  # section is a strong signal

    # Source B — profile topic_clusters already accumulated
    for cluster in (ctx.user.topic_clusters or []):
        name = cluster.get("cluster") or cluster.get("section") or ""
        count = cluster.get("item_count", 1)
        if name:
            topics[name.lower()] += count

    # Return topics sorted by accumulated weight, top 6
    return [topic for topic, _ in topics.most_common(6)]
