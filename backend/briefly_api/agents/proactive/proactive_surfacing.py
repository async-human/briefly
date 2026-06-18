"""
briefly_api/agents/proactive/proactive_surfacing.py

ProactiveSurfacingAgent — manages the proactive notification queue.

Two functions:
  1. get_pending_events(session, user_id) — returns events to inject into the
     current digest (called by the pipeline just before BriefingWriterAgent)
  2. mark_surfaced(session, event_ids) — marks events as consumed

The agent enforces the `proactive_max_per_user_per_day` cap to prevent
notification fatigue while ensuring the highest-priority events surface first.

Event priorities:
  10  breaking_development + matches active story thread
   9  thread_update with recent appearances ≥ 3
   8  breaking_development (general)
   6  voice_note_connection
   5  coverage_gap_alert (injected as "today I looked harder for...")
   4  coverage_gap_alert (standard)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from briefly_api.config import get_settings
from briefly_api.db.models import ProactiveSurfacingEvent, UserProfile

log = logging.getLogger(__name__)


async def queue_relevant_content_event(session, user_id: str) -> bool:
    """
    Create a `relevant_content` proactive event from the top freshly-discovered
    article (scored against the user's learned interests). Idempotent per 24h.
    Returns True if an event was created. Caller commits.
    """
    s = get_settings()
    if not s.proactive_surfacing_enabled:
        return False

    profile = (
        await session.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    ).scalar_one_or_none()
    articles = list(getattr(profile, "discovered_articles", None) or []) if profile else []
    if not articles:
        return False

    def _score(a: dict) -> float:
        try:
            return float(a.get("relevance_score") or 0)
        except (TypeError, ValueError):
            return 0.0

    top = max(articles, key=_score)
    if _score(top) < s.relevant_content_min_score:
        return False

    title = (top.get("title") or "").strip()
    if not title:
        return False

    # Don't fire more than one relevant_content alert per 24h.
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    existing = (
        await session.execute(
            select(ProactiveSurfacingEvent).where(
                ProactiveSurfacingEvent.user_id == user_id,
                ProactiveSurfacingEvent.event_type == "relevant_content",
                ProactiveSurfacingEvent.created_at >= cutoff,
            )
        )
    ).scalars().first()
    if existing:
        return False

    why = (top.get("why_relevant") or top.get("summary") or "Matches what you've been reading.").strip()
    url = top.get("url") or ""

    session.add(
        ProactiveSurfacingEvent(
            user_id=user_id,
            event_type="relevant_content",
            title=f"Worth a look: {title[:80]}",
            body=why[:300],
            content_ids=[url] if url else [],
            thread_key=top.get("intent_topic"),
            priority=7,
        )
    )
    await session.flush()
    log.info("queue_relevant_content_event: queued for user %s", user_id)
    return True


async def get_pending_events(session, user_id: str) -> list[dict]:
    """
    Return the highest-priority unsurfaced events for inclusion in the
    current digest cycle, up to `proactive_max_per_user_per_day`.
    """
    s = get_settings()
    if not s.proactive_surfacing_enabled:
        return []

    # Already surfaced today?
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    already_result = await session.execute(
        select(ProactiveSurfacingEvent).where(
            ProactiveSurfacingEvent.user_id == user_id,
            ProactiveSurfacingEvent.surfaced_at >= today_start,
        ).limit(s.proactive_max_per_user_per_day)
    )
    already_surfaced = already_result.scalars().all()
    if len(already_surfaced) >= s.proactive_max_per_user_per_day:
        return []

    remaining_slots = s.proactive_max_per_user_per_day - len(already_surfaced)

    # Load pending events, highest priority first, created in last 48h
    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
    result = await session.execute(
        select(ProactiveSurfacingEvent)
        .where(
            ProactiveSurfacingEvent.user_id == user_id,
            ProactiveSurfacingEvent.surfaced_at.is_(None),
            ProactiveSurfacingEvent.dismissed_at.is_(None),
            ProactiveSurfacingEvent.created_at >= cutoff,
        )
        .order_by(
            ProactiveSurfacingEvent.priority.desc(),
            ProactiveSurfacingEvent.created_at.asc(),
        )
        .limit(remaining_slots)
    )
    events = result.scalars().all()

    return [
        {
            "id":           e.id,
            "event_type":   e.event_type,
            "title":        e.title,
            "body":         e.body,
            "thread_key":   e.thread_key,
            "content_ids":  e.content_ids,
            "priority":     e.priority,
        }
        for e in events
    ]


async def mark_surfaced(session, event_ids: list[str]) -> None:
    """Mark a list of ProactiveSurfacingEvents as consumed."""
    if not event_ids:
        return
    await session.execute(
        update(ProactiveSurfacingEvent)
        .where(ProactiveSurfacingEvent.id.in_(event_ids))
        .values(surfaced_at=datetime.now(timezone.utc))
    )
    await session.flush()


async def mark_dismissed(session, event_id: str) -> None:
    """Mark an event as dismissed by the user."""
    await session.execute(
        update(ProactiveSurfacingEvent)
        .where(ProactiveSurfacingEvent.id == event_id)
        .values(dismissed_at=datetime.now(timezone.utc))
    )
    await session.flush()


async def get_for_api(session, user_id: str) -> list[dict]:
    """
    Return unsurfaced proactive events for the frontend to display.
    Used by the dashboard API to show proactive notifications.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
    result = await session.execute(
        select(ProactiveSurfacingEvent)
        .where(
            ProactiveSurfacingEvent.user_id == user_id,
            ProactiveSurfacingEvent.surfaced_at.is_(None),
            ProactiveSurfacingEvent.dismissed_at.is_(None),
            ProactiveSurfacingEvent.created_at >= cutoff,
        )
        .order_by(
            ProactiveSurfacingEvent.priority.desc(),
            ProactiveSurfacingEvent.created_at.desc(),
        )
        .limit(5)
    )
    events = result.scalars().all()
    return [
        {
            "id":         e.id,
            "event_type": e.event_type,
            "title":      e.title,
            "body":       e.body,
            "thread_key": e.thread_key,
            "priority":   e.priority,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events
    ]
