"""
briefly_api/agents/proactive/content_watcher.py

ContentWatcherAgent — runs every 4 hours.

Responsibilities:
  1. Detect new RawContent items that have not been enriched yet
  2. Update SourceFetchPattern timing data (learns when each source publishes)
  3. Detect breaking developments: 3+ distinct sources covering the same topic
     within a 6-hour window → writes BreakingDevelopmentEvent
  4. Queue ProactiveSurfacingEvent for breaking developments in tracked threads

The agent does NOT fetch content — that is SourceCollectorAgent's job.  It
only analyses what is already in the RawContent pool.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from briefly_api.config import get_settings
from briefly_api.db.models import (
    BreakingDevelopmentEvent,
    ContentEnrichmentCache,
    ProactiveSurfacingEvent,
    RawContent,
    Source,
    SourceFetchPattern,
    UserMemory,
    UserProfile,
)

log = logging.getLogger(__name__)


async def run_for_user(session, user_id: str) -> dict:
    """
    Run the ContentWatcherAgent for one user.
    Returns a summary dict.
    """
    s = get_settings()
    if not s.content_watcher_enabled:
        return {"skipped": True}

    # ── Find unenriched pool items ────────────────────────────────────────────
    enriched_ids_result = await session.execute(
        select(ContentEnrichmentCache.content_id).where(
            ContentEnrichmentCache.user_id == user_id
        )
    )
    enriched_ids = {row[0] for row in enriched_ids_result.all()}

    new_content_result = await session.execute(
        select(RawContent)
        .where(
            RawContent.user_id == user_id,
            RawContent.id.notin_(enriched_ids),
            RawContent.ingested_at >= datetime.now(timezone.utc) - timedelta(hours=s.pool_max_age_hours),
        )
        .order_by(RawContent.ingested_at.desc())
        .limit(200)
    )
    new_items = new_content_result.scalars().all()

    # ── Update SourceFetchPattern timing data ─────────────────────────────────
    source_latest: dict[str, datetime] = {}
    for item in new_items:
        if item.source_id and item.ingested_at:
            ts = item.ingested_at
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if item.source_id not in source_latest or ts > source_latest[item.source_id]:
                source_latest[item.source_id] = ts

    for source_id, latest_ts in source_latest.items():
        await _update_source_fetch_pattern(session, source_id, latest_ts)

    # ── Breaking development detection ────────────────────────────────────────
    window_cutoff = datetime.now(timezone.utc) - timedelta(
        hours=s.breaking_development_window_hours
    )
    recent_items = [
        i for i in new_items
        if i.ingested_at and (
            i.ingested_at.replace(tzinfo=timezone.utc) if i.ingested_at.tzinfo is None
            else i.ingested_at
        ) >= window_cutoff
    ]

    breaking_count = await _detect_breaking_developments(
        session, user_id, recent_items, s
    )

    log.info(
        "ContentWatcherAgent: user=%s new=%d breaking=%d",
        user_id, len(new_items), breaking_count,
    )
    return {
        "new_items": len(new_items),
        "breaking_developments": breaking_count,
    }


async def _update_source_fetch_pattern(
    session, source_id: str, content_arrived_at: datetime
) -> None:
    """Record when content arrived for this source to learn its publishing cadence."""
    result = await session.execute(
        select(SourceFetchPattern).where(SourceFetchPattern.source_id == source_id)
    )
    pattern = result.scalar_one_or_none()

    hour = content_arrived_at.hour  # UTC hour of content arrival
    if pattern is None:
        pattern = SourceFetchPattern(
            source_id=source_id,
            best_fetch_hour=hour,
            content_arrival_pattern={"hourly_distribution": [0] * 24, "samples": 0},
            last_content_at=content_arrived_at,
            pattern_confidence=0.1,
        )
        session.add(pattern)
    else:
        dist = list(pattern.content_arrival_pattern.get("hourly_distribution", [0] * 24))
        if len(dist) < 24:
            dist = (dist + [0] * 24)[:24]
        dist[hour] += 1
        samples = pattern.content_arrival_pattern.get("samples", 0) + 1

        # Recompute best_fetch_hour as the hour with most arrivals
        best_hour = dist.index(max(dist))
        confidence = min(1.0, samples / 30.0)  # full confidence after 30 samples

        pattern.content_arrival_pattern = {
            "hourly_distribution": dist,
            "samples": samples,
            "peak_hours": sorted(
                range(24), key=lambda h: dist[h], reverse=True
            )[:3],
        }
        pattern.best_fetch_hour = best_hour
        pattern.pattern_confidence = round(confidence, 3)
        pattern.last_content_at = content_arrived_at

    await session.flush()


async def _detect_breaking_developments(
    session,
    user_id: str,
    recent_items: list[RawContent],
    s,
) -> int:
    """
    Cluster recent items by topic keywords.  If 3+ distinct sources cover the
    same topic in the window → BreakingDevelopmentEvent.
    """
    if not recent_items:
        return 0

    # Load user's active story threads as the topic vocabulary
    threads_result = await session.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id,
            UserMemory.memory_type == "story_thread",
        )
    )
    threads = threads_result.scalars().all()
    thread_keys = [t.key for t in threads]

    # Also build keyword list from user interests
    profile_result = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = profile_result.scalar_one_or_none()
    if profile:
        for interest in (profile.interests or []):
            topic = (interest.get("topic") or "").strip().lower()
            if topic and topic not in thread_keys:
                thread_keys.append(topic)

    if not thread_keys:
        return 0

    # Map topic → {source_id, content_id} to count distinct sources
    topic_hits: dict[str, dict[str, set]] = defaultdict(lambda: {"sources": set(), "ids": []})

    for item in recent_items:
        item_text = ((item.title or "") + " " + (item.clean_text or "")[:200]).lower()
        for topic_key in thread_keys:
            words = {w for w in topic_key.split() if len(w) > 3}
            if words and sum(1 for w in words if w in item_text) >= min(2, len(words)):
                topic_hits[topic_key]["sources"].add(item.source_id or item.id)
                topic_hits[topic_key]["ids"].append(item.id)

    # Create BreakingDevelopmentEvent for topics crossing the threshold
    created = 0
    for topic_key, data in topic_hits.items():
        if len(data["sources"]) < s.breaking_development_min_sources:
            continue

        # Check if we already created one recently for this topic
        existing_result = await session.execute(
            select(BreakingDevelopmentEvent).where(
                BreakingDevelopmentEvent.user_id == user_id,
                BreakingDevelopmentEvent.topic == topic_key,
                BreakingDevelopmentEvent.detected_at >= datetime.now(timezone.utc) - timedelta(hours=12),
            )
        )
        if existing_result.scalar_one_or_none():
            continue

        event = BreakingDevelopmentEvent(
            user_id=user_id,
            topic=topic_key,
            content_ids=list(set(data["ids"]))[:10],
            source_count=len(data["sources"]),
        )
        session.add(event)

        # Queue proactive surfacing
        surfacing = ProactiveSurfacingEvent(
            user_id=user_id,
            event_type="breaking_development",
            title=f"Breaking: {topic_key}",
            body=(
                f"{len(data['sources'])} sources are covering '{topic_key}' right now. "
                f"This will be elevated in your next briefing."
            ),
            content_ids=list(set(data["ids"]))[:10],
            thread_key=topic_key,
            priority=8,
        )
        session.add(surfacing)
        created += 1

    if created:
        await session.flush()

    return created
