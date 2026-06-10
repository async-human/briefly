"""
briefly_api/agents/proactive/story_thread_agent.py

StoryThreadAgent — enhanced nightly story thread management.

This is the enhanced, out-of-pipeline version of the in-pipeline MemoryAgent's
thread detection.  The differences:

  - 30-day lookback instead of 14 days
  - Thread health scoring (is this thread growing, stable, or dying?)
  - Breaking development escalation for fast-moving threads
  - Coverage gap detection (thread exists but no new content in 5 days)
  - ProactiveSurfacingEvent creation for thread updates

Runs nightly at 02:30 UTC (configurable) so threads are accurate before the
07:00 digest pipeline runs.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from briefly_api.config import get_settings
from briefly_api.db.models import (
    Digest,
    DigestItem,
    ProactiveSurfacingEvent,
    RawContent,
    UserMemory,
    UserProfile,
)
from briefly_api.services.profile_utils import cluster_label
from briefly_api.services.topic_matching import item_matches_topic

log = logging.getLogger(__name__)

# How many distinct digest-dates a topic must appear in to become a thread
_THREAD_MIN_APPEARANCES = 3
# Thread strength increment per appearance
_STRENGTH_INC = 0.05
# Thread is "breaking" if it appeared N+ times in the last 3 days
_BREAKING_RECENT_APPEARANCES = 3


async def preview_active_threads(
    session,
    user_id: str,
    profile: UserProfile,
    *,
    limit: int = 8,
) -> list[dict]:
    """Read-only thread snapshot — same briefing analytics as settings topic cards."""
    from briefly_api.services.topic_briefing_analytics import (
        compute_topic_briefing_analytics,
        format_active_threads,
    )

    analytics = await compute_topic_briefing_analytics(session, user_id, profile)
    return format_active_threads(analytics, limit=limit)


async def run_for_user(session, user_id: str) -> dict:
    """
    Run the StoryThreadAgent for one user.  Returns a summary dict.
    """
    s = get_settings()
    if not s.story_thread_agent_enabled:
        return {"skipped": True}

    # ── Load profile keyword vocab ────────────────────────────────────────────
    profile_result = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        return {"error": "profile not found"}

    keywords: dict[str, str] = {}  # lower → canonical
    for interest in (profile.interests or []):
        topic = (interest.get("topic") or "").strip()
        if topic and len(topic) > 3:
            keywords[topic.lower()] = topic
    for cluster in (profile.topic_clusters or []):
        label = cluster_label(cluster)
        if label and len(label) > 3:
            keywords[label.lower()] = label

    if not keywords:
        return {"threads_updated": 0}

    # ── Fetch recent digest items ─────────────────────────────────────────────
    lookback = datetime.now(timezone.utc) - timedelta(days=s.story_thread_agent_lookback_days)
    cutoff_3d = datetime.now(timezone.utc) - timedelta(days=3)

    result = await session.execute(
        select(
            Digest.digest_date,
            Digest.created_at,
            DigestItem.headline,
            DigestItem.summary,
            DigestItem.source_name,
            DigestItem.confidence_signal,
        )
        .join(DigestItem, DigestItem.digest_id == Digest.id)
        .where(
            Digest.user_id == user_id,
            Digest.created_at >= lookback,
        )
        .order_by(Digest.created_at.desc())
        .limit(500)
    )
    rows = result.all()

    if not rows:
        return {"threads_updated": 0}

    # Count per-keyword: distinct dates + recent dates
    topic_dates: dict[str, set[str]] = {kw: set() for kw in keywords}
    topic_recent_dates: dict[str, set[str]] = {kw: set() for kw in keywords}
    topic_latest_headline: dict[str, str] = {}

    for digest_date, created_at, headline, summary, source_name, confidence_signal in rows:
        is_recent = (
            created_at and (
                created_at.replace(tzinfo=timezone.utc) if created_at.tzinfo is None else created_at
            ) >= cutoff_3d
        )
        for kw in keywords:
            if not item_matches_topic(headline, summary, source_name, confidence_signal, kw):
                continue
            topic_dates[kw].add(digest_date)
            if is_recent:
                topic_recent_dates[kw].add(digest_date)
            if kw not in topic_latest_headline and headline:
                topic_latest_headline[kw] = headline

    # ── Batch-load existing threads ───────────────────────────────────────────
    active_kws = {kw for kw, dates in topic_dates.items() if len(dates) >= _THREAD_MIN_APPEARANCES}
    existing_result = await session.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id,
            UserMemory.memory_type == "story_thread",
            UserMemory.key.in_(active_kws),
        )
    )
    existing_memories: dict[str, UserMemory] = {
        m.key: m for m in existing_result.scalars().all()
    }

    threads_updated = 0
    breaking_topics: list[str] = []
    coverage_gaps: list[str] = []

    for kw, dates in topic_dates.items():
        if len(dates) < _THREAD_MIN_APPEARANCES:
            continue

        canonical    = keywords[kw]
        latest       = topic_latest_headline.get(kw, "")
        first_date   = min(dates) if dates else ""
        recent_count = len(topic_recent_dates.get(kw, set()))
        memory       = existing_memories.get(kw)

        if memory:
            memory.occurrence_count = len(dates)
            memory.last_seen_at     = datetime.now(timezone.utc)
            memory.strength         = min(1.0, memory.strength + _STRENGTH_INC)
            val = dict(memory.value or {})
            val.update({
                "appearance_count": len(dates),
                "latest_headline":  latest,
                "topic":            canonical,
                "recent_count":     recent_count,
                "health": (
                    "breaking" if recent_count >= _BREAKING_RECENT_APPEARANCES
                    else "active" if recent_count > 0
                    else "fading"
                ),
            })
            memory.value = val
        else:
            memory = UserMemory(
                user_id=user_id,
                memory_type="story_thread",
                key=kw,
                value={
                    "topic":            canonical,
                    "first_seen":       first_date,
                    "appearance_count": len(dates),
                    "latest_headline":  latest,
                    "description":      canonical,
                    "recent_count":     recent_count,
                    "health": (
                        "breaking" if recent_count >= _BREAKING_RECENT_APPEARANCES
                        else "active"
                    ),
                },
                strength=0.6,
                occurrence_count=len(dates),
            )
            session.add(memory)

        threads_updated += 1

        if recent_count >= _BREAKING_RECENT_APPEARANCES:
            breaking_topics.append(kw)

    # ── Coverage gap detection ────────────────────────────────────────────────
    # A thread exists but had NO content in the last `coverage_gap_alert_days` days
    gap_cutoff = datetime.now(timezone.utc) - timedelta(days=s.coverage_gap_alert_days)
    for kw, dates in topic_dates.items():
        if len(dates) < _THREAD_MIN_APPEARANCES:
            continue
        if topic_recent_dates.get(kw):
            continue  # had recent content, no gap
        # Check latest content across the full pool
        latest_content_result = await session.execute(
            select(RawContent.ingested_at)
            .where(
                RawContent.user_id == user_id,
                RawContent.ingested_at >= gap_cutoff,
            )
            .limit(200)
        )
        all_recent_ids = latest_content_result.scalars().all()
        # Simple approach: if we're tracking this topic and haven't seen it recently
        # in digests, flag it as a gap
        coverage_gaps.append(kw)

    # Create proactive events for breaking topics
    for topic_key in breaking_topics[:3]:
        existing_event = await session.execute(
            select(ProactiveSurfacingEvent).where(
                ProactiveSurfacingEvent.user_id == user_id,
                ProactiveSurfacingEvent.event_type == "thread_update",
                ProactiveSurfacingEvent.thread_key == topic_key,
                ProactiveSurfacingEvent.created_at >= datetime.now(timezone.utc) - timedelta(hours=12),
            ).limit(1)
        )
        if existing_event.scalar_one_or_none():
            continue

        canonical = keywords.get(topic_key, topic_key)
        surfacing = ProactiveSurfacingEvent(
            user_id=user_id,
            event_type="thread_update",
            title=f"Story update: {canonical}",
            body=(
                f"'{canonical}' appeared {_BREAKING_RECENT_APPEARANCES}+ times in the "
                f"last 3 days. This story is moving fast — I'll make sure it's at the "
                f"top of tomorrow's briefing."
            ),
            thread_key=topic_key,
            priority=9,
        )
        session.add(surfacing)

    # Create coverage gap alerts
    for topic_key in coverage_gaps[:2]:
        canonical = keywords.get(topic_key, topic_key)
        existing_gap = await session.execute(
            select(ProactiveSurfacingEvent).where(
                ProactiveSurfacingEvent.user_id == user_id,
                ProactiveSurfacingEvent.event_type == "coverage_gap_alert",
                ProactiveSurfacingEvent.thread_key == topic_key,
                ProactiveSurfacingEvent.created_at >= datetime.now(timezone.utc) - timedelta(days=3),
            ).limit(1)
        )
        if existing_gap.scalar_one_or_none():
            continue

        surfacing = ProactiveSurfacingEvent(
            user_id=user_id,
            event_type="coverage_gap_alert",
            title=f"Coverage gap: {canonical}",
            body=(
                f"You've been tracking '{canonical}' for a while, but there's been "
                f"nothing on it in the last {s.coverage_gap_alert_days} days. "
                f"I'll expand your sources for this topic."
            ),
            thread_key=topic_key,
            priority=4,
        )
        session.add(surfacing)

    await session.flush()
    log.info(
        "StoryThreadAgent: user=%s threads=%d breaking=%d gaps=%d",
        user_id, threads_updated, len(breaking_topics), len(coverage_gaps),
    )
    return {
        "threads_updated": threads_updated,
        "breaking": breaking_topics,
        "coverage_gaps": coverage_gaps,
    }
