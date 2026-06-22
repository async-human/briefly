"""
briefly_api/services/proactive_gate.py

Context-aware delivery gate: decide whether to interrupt the user *right now*
with a push, or hold the event in the orb inbox until a better moment.

  should_push(user_id, priority) -> "push" | "hold"

Rules (in order):
  1. priority >= push_always_priority  → always "push" (urgent overrides context)
  2. quiet hours (user's local night)  → "hold"
  3. in a calendar meeting right now    → "hold"
  4. otherwise                          → "push"

The calendar "busy now" check is cached per user (~5 min) so a single notifier
run doesn't hammer the Calendar API once per event.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select

from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import UserProfile

log = logging.getLogger(__name__)

_busy_cache: dict[str, tuple[float, bool]] = {}
_BUSY_TTL_SEC = 300


def _user_tz(tz_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _matches_priority_topics(text: str | None, priority_topics: list[str]) -> bool:
    """True if the event text mentions any of the user's "afraid to miss" topics."""
    if not text or not priority_topics:
        return False
    low = text.lower()
    return any(topic and topic in low for topic in priority_topics)


def _in_quiet_hours(tz: ZoneInfo, start_h: int, end_h: int) -> bool:
    if start_h == end_h:
        return False
    hour = datetime.now(tz).hour
    if start_h < end_h:
        return start_h <= hour < end_h
    # Window wraps midnight (e.g. 22 → 7).
    return hour >= start_h or hour < end_h


def _now_within_a_meeting(events: list[dict]) -> bool:
    now = datetime.now(timezone.utc)
    for ev in events:
        start_raw, end_raw = ev.get("start"), ev.get("end")
        if not start_raw or not end_raw or "T" not in start_raw:
            continue  # all-day events don't count as "busy"
        try:
            start = datetime.fromisoformat(start_raw.replace("Z", "+00:00")).astimezone(timezone.utc)
            end = datetime.fromisoformat(end_raw.replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            continue
        if start <= now < end:
            return True
    return False


async def _is_busy_now(user_id: str, tz_name: str | None) -> bool:
    now = time.time()
    cached = _busy_cache.get(user_id)
    if cached and now - cached[0] < _BUSY_TTL_SEC:
        return cached[1]

    busy = False
    try:
        from briefly_api.auth.calendar import (
            get_calendar_connection,
            refresh_calendar_access_token,
        )
        from briefly_api.services.calendar_briefing import fetch_todays_events

        async with SessionLocal() as session:
            conn = await get_calendar_connection(session, user_id)
            if conn:
                token = await refresh_calendar_access_token(conn, get_settings())
                run_date = datetime.now(_user_tz(tz_name)).strftime("%Y-%m-%d")
                events = await fetch_todays_events(token, tz_name or "UTC", run_date)
                busy = _now_within_a_meeting(events)
    except Exception:
        log.debug("proactive_gate: busy check failed for %s", user_id, exc_info=True)
        busy = False

    _busy_cache[user_id] = (now, busy)
    return busy


async def should_push(user_id: str, priority: int, *, topic_text: str | None = None) -> str:
    """Return "push" or "hold" for delivering a proactive event right now.

    `topic_text` (event title/body/thread) is matched against the user's
    onboarding "what are you most afraid to miss?" topics; a match boosts the
    event's effective priority so those alerts break through quiet hours / busy.
    """
    s = get_settings()

    if priority >= s.push_always_priority:
        return "push"

    profile = None
    try:
        async with SessionLocal() as session:
            profile = (
                await session.execute(
                    select(UserProfile).where(UserProfile.user_id == user_id)
                )
            ).scalar_one_or_none()
    except Exception:
        log.debug("proactive_gate: profile load failed for %s", user_id, exc_info=True)

    priority_topics = list((getattr(profile, "profile_meta", None) or {}).get("priority_topics", []))
    if _matches_priority_topics(topic_text, priority_topics):
        priority += s.priority_topic_boost
        if priority >= s.push_always_priority:
            return "push"

    tz_name = getattr(profile, "digest_timezone", None)
    tz = _user_tz(tz_name)

    if _in_quiet_hours(tz, s.quiet_hours_start, s.quiet_hours_end):
        return "hold"

    if s.push_respect_calendar_busy and await _is_busy_now(user_id, tz_name):
        return "hold"

    return "push"
