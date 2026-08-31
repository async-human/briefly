"""Meeting-aware briefing context from Google Calendar."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select

from briefly_api.auth.calendar import (
    CALENDAR_API,
    GoogleTokenRevoked,
    get_calendar_connection,
    refresh_calendar_access_token,
)
from briefly_api.config import get_settings
from briefly_api.db.models import ProactiveSurfacingEvent, UserMemory, UserProfile

log = logging.getLogger(__name__)

_STOPWORDS = frozenset(
    "a an the and or for with from your our their about into over after before".split()
)


def _keywords(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]{3,}", (text or "").lower())
    return {w for w in words if w not in _STOPWORDS}


def _format_time(iso: str, tz: ZoneInfo) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(tz)
        label = dt.strftime("%I:%M %p")
        return label.lstrip("0") if label.startswith("0") else label
    except Exception:
        return ""


def _day_label(iso: str, tz: ZoneInfo, today: datetime.date) -> str | None:
    try:
        if "T" not in iso:
            day = datetime.strptime(iso, "%Y-%m-%d").date()
        else:
            day = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(tz).date()
        if day == today:
            return None
        if day == today + timedelta(days=1):
            return "Tomorrow"
        return day.strftime("%a")
    except Exception:
        return None


async def fetch_events_between(
    access_token: str,
    timezone_str: str,
    range_start: datetime,
    range_end: datetime,
) -> list[dict]:
    try:
        tz = ZoneInfo(timezone_str)
    except Exception:
        tz = ZoneInfo("UTC")

    params = {
        "timeMin": range_start.isoformat(),
        "timeMax": range_end.isoformat(),
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": 20,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            f"{CALENDAR_API}/calendars/primary/events",
            params=params,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code in {401, 403}:
            log.warning("Calendar API access denied: %s", resp.text[:200])
            return []
        resp.raise_for_status()
        data = resp.json()

    today = datetime.now(tz).date()
    events: list[dict] = []
    for ev in data.get("items") or []:
        if ev.get("status") == "cancelled":
            continue
        start_raw = (ev.get("start") or {}).get("dateTime") or (ev.get("start") or {}).get("date")
        if not start_raw:
            continue
        attendees = [
            a.get("displayName") or a.get("email", "").split("@")[0]
            for a in (ev.get("attendees") or [])
            if not a.get("self") and (a.get("displayName") or a.get("email"))
        ]
        end_raw = (ev.get("end") or {}).get("dateTime") or (ev.get("end") or {}).get("date")
        day_label = _day_label(start_raw, tz, today)
        time_label = _format_time(start_raw, tz) if "T" in start_raw else "All day"
        events.append(
            {
                "title": (ev.get("summary") or "Untitled meeting").strip(),
                "start": start_raw,
                "end": end_raw,
                "start_label": time_label,
                "day_label": day_label,
                "attendees": attendees[:6],
                "description": (ev.get("description") or "")[:300],
            }
        )
    return events


async def fetch_todays_events(
    access_token: str,
    timezone_str: str,
    run_date: str,
) -> list[dict]:
    try:
        tz = ZoneInfo(timezone_str)
    except Exception:
        tz = ZoneInfo("UTC")

    day = datetime.strptime(run_date, "%Y-%m-%d").date()
    start = datetime.combine(day, datetime.min.time(), tzinfo=tz)
    end = start + timedelta(days=1)
    return await fetch_events_between(access_token, timezone_str, start, end)


async def fetch_upcoming_events(
    access_token: str,
    timezone_str: str,
    *,
    days: int = 2,
) -> list[dict]:
    """Events from start of today through end of `days` calendar days (default: today + tomorrow)."""
    try:
        tz = ZoneInfo(timezone_str)
    except Exception:
        tz = ZoneInfo("UTC")

    start = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    last_day = start.date() + timedelta(days=max(days, 1) - 1)
    end = datetime.combine(last_day, datetime.max.time().replace(microsecond=0), tzinfo=tz)
    return await fetch_events_between(access_token, timezone_str, start, end)


def _match_items(
    event: dict,
    items: list,
    selected_ids: set[str],
) -> list[dict]:
    keys = _keywords(event["title"]) | _keywords(event.get("description", ""))
    for name in event.get("attendees") or []:
        keys |= _keywords(name)
        if "@" in name:
            domain = name.split("@")[-1].split(".")[0]
            if len(domain) > 2:
                keys.add(domain.lower())

    matches: list[tuple[float, dict]] = []
    for item in items:
        if item.id not in selected_ids:
            continue
        title_keys = _keywords(getattr(item, "title", "") or "")
        overlap = keys & title_keys
        if not overlap and keys:
            title_low = (getattr(item, "title", "") or "").lower()
            overlap = {k for k in keys if k in title_low}
        if overlap:
            score = len(overlap) / max(len(keys), 1)
            matches.append(
                (
                    score,
                    {
                        "headline": getattr(item, "title", ""),
                        "source": getattr(item, "source_name", ""),
                        "content_id": item.id,
                    },
                )
            )
    matches.sort(key=lambda x: x[0], reverse=True)
    return [m[1] for m in matches[:3]]


def _match_threads(event: dict, story_threads: list[dict]) -> list[str]:
    keys = _keywords(event["title"]) | _keywords(event.get("description", ""))
    hits: list[str] = []
    for thread in story_threads[:12]:
        topic = (thread.get("topic") or thread.get("key") or "").strip()
        if not topic:
            continue
        topic_keys = _keywords(topic)
        if keys & topic_keys or any(k in topic.lower() for k in keys if len(k) > 3):
            hits.append(topic)
    return hits[:2]


def build_meeting_briefing(
    events: list[dict],
    enriched_items: list,
    selected_ids: list[str],
    story_threads: list[dict],
) -> dict | None:
    if not events:
        return None

    selected = set(selected_ids)
    meetings: list[dict] = []
    for ev in events:
        relevant = _match_items(ev, enriched_items, selected)
        threads = _match_threads(ev, story_threads)
        if not relevant and not threads:
            continue
        meetings.append(
            {
                "title": ev["title"],
                "time": ev["start_label"],
                "day_label": ev.get("day_label"),
                "attendees": ev.get("attendees") or [],
                "relevant_stories": relevant,
                "active_threads": threads,
            }
        )

    if not meetings:
        # Still surface upcoming meetings even without matches
        meetings = [
            {
                "title": ev["title"],
                "time": ev["start_label"],
                "day_label": ev.get("day_label"),
                "attendees": ev.get("attendees") or [],
                "relevant_stories": [],
                "active_threads": [],
            }
            for ev in events[:4]
        ]

    summary_lines = []
    for m in meetings[:4]:
        when = m["time"]
        if m.get("day_label"):
            when = f"{m['day_label']} {when}"
        line = f"- {when}: {m['title']}"
        if m["attendees"]:
            line += f" (with {', '.join(m['attendees'][:3])})"
        if m["relevant_stories"]:
            line += f" — {len(m['relevant_stories'])} relevant stor{'y' if len(m['relevant_stories']) == 1 else 'ies'}"
        if m["active_threads"]:
            line += f" — threads: {', '.join(m['active_threads'])}"
        summary_lines.append(line)

    return {
        "meetings": meetings,
        "summary_text": "\n".join(summary_lines),
        "meeting_count": len(events),
    }


async def load_calendar_briefing(
    session,
    user_id: str,
    timezone_str: str,
    run_date: str,
    enriched_items: list,
    selected_item_ids: list[str],
    story_threads: list[dict],
    *,
    upcoming_days: int = 1,
) -> dict | None:
    connection = await get_calendar_connection(session, user_id)
    if not connection:
        return None

    settings = get_settings()
    try:
        access_token = await refresh_calendar_access_token(connection, settings)
        if upcoming_days > 1:
            events = await fetch_upcoming_events(
                access_token, timezone_str, days=upcoming_days,
            )
        else:
            events = await fetch_todays_events(access_token, timezone_str, run_date)
    except GoogleTokenRevoked:
        log.warning("Calendar briefing skipped for user %s — reconnect Google Calendar", user_id)
        return None
    except Exception:
        log.debug("Calendar briefing load failed for user %s", user_id, exc_info=True)
        return None

    return build_meeting_briefing(events, enriched_items, selected_item_ids, story_threads)


async def load_upcoming_meetings(session, user_id: str) -> dict | None:
    """Lightweight upcoming-meetings fetch for the dashboard (today + tomorrow)."""
    connection = await get_calendar_connection(session, user_id)
    if not connection:
        return None

    profile = (
        await session.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    ).scalar_one_or_none()
    tz = (getattr(profile, "digest_timezone", None) or "UTC") if profile else "UTC"

    settings = get_settings()
    try:
        access_token = await refresh_calendar_access_token(connection, settings)
        events = await fetch_upcoming_events(access_token, tz, days=2)
    except GoogleTokenRevoked:
        log.warning("Upcoming meetings skipped for user %s — reconnect Google Calendar", user_id)
        return None
    except Exception:
        log.debug("load_upcoming_meetings failed for user %s", user_id, exc_info=True)
        return None

    if not events:
        return {"meetings": [], "meeting_count": 0, "summary_text": None}

    briefing = build_meeting_briefing(events, [], [], [])
    return briefing


async def queue_meeting_prep_event(session, user_id: str) -> bool:
    """
    Create one `meeting_prep` proactive event summarizing today's meetings (with
    any active story threads that match). Idempotent per day. Returns True if a
    new event was created; the caller commits.
    """
    s = get_settings()
    if not s.proactive_surfacing_enabled:
        return False

    if not await get_calendar_connection(session, user_id):
        return False

    profile = (
        await session.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    ).scalar_one_or_none()
    tz = (getattr(profile, "digest_timezone", None) or "UTC") if profile else "UTC"
    try:
        run_date = datetime.now(ZoneInfo(tz)).strftime("%Y-%m-%d")
    except Exception:
        run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Cheap thread context (no enriched items needed here).
    thread_rows = (
        await session.execute(
            select(UserMemory).where(
                UserMemory.user_id == user_id,
                UserMemory.memory_type == "story_thread",
            )
        )
    ).scalars().all()
    story_threads = [{"topic": t.key} for t in thread_rows]

    briefing = await load_calendar_briefing(
        session, user_id, tz, run_date, [], [], story_threads, upcoming_days=2,
    )
    if not briefing or not briefing.get("meetings"):
        return False

    # Idempotent: at most one meeting_prep per day.
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    existing = (
        await session.execute(
            select(ProactiveSurfacingEvent).where(
                ProactiveSurfacingEvent.user_id == user_id,
                ProactiveSurfacingEvent.event_type == "meeting_prep",
                ProactiveSurfacingEvent.created_at >= today_start,
            )
        )
    ).scalars().first()
    if existing:
        return False

    count = briefing.get("meeting_count") or len(briefing["meetings"])
    title = f"{count} upcoming meeting{'s' if count != 1 else ''} on your calendar"
    body = briefing.get("summary_text") or "You have meetings today — here's the rundown."

    session.add(
        ProactiveSurfacingEvent(
            user_id=user_id,
            event_type="meeting_prep",
            title=title,
            body=body[:400],
            content_ids=[],
            thread_key=None,
            priority=8,
        )
    )
    await session.flush()
    log.info("queue_meeting_prep_event: queued for user %s (%d meetings)", user_id, count)
    return True


def _meeting_thread_key(event: dict) -> str:
    """Stable per-meeting key for idempotency (start time + title)."""
    start = (event.get("start") or "")[:16]  # to the minute
    title = (event.get("title") or "").strip().lower()[:60]
    return f"meeting:{start}:{title}"


async def queue_imminent_meeting_prep(session, user_id: str) -> int:
    """
    Fire a focused, high-priority `meeting_prep` event for each meeting starting
    within the next `meeting_prep_lead_minutes` — the "you meet X in 30 min,
    here's what changed in your world" moment. Idempotent per meeting. Returns
    the number of new events queued; the caller commits.
    """
    s = get_settings()
    if not (s.proactive_surfacing_enabled and s.meeting_prep_enabled):
        return 0

    connection = await get_calendar_connection(session, user_id)
    if not connection:
        return 0

    profile = (
        await session.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    ).scalar_one_or_none()
    tz = (getattr(profile, "digest_timezone", None) or "UTC") if profile else "UTC"

    now = datetime.now(timezone.utc)
    window_end = now + timedelta(minutes=max(1, s.meeting_prep_lead_minutes))
    try:
        access_token = await refresh_calendar_access_token(connection, get_settings())
        events = await fetch_events_between(access_token, tz, now, window_end)
    except GoogleTokenRevoked:
        log.warning("queue_imminent_meeting_prep skipped for %s — reconnect Google Calendar", user_id)
        return 0
    except Exception:
        log.debug("queue_imminent_meeting_prep: fetch failed for %s", user_id, exc_info=True)
        return 0

    # Only timed meetings that actually START inside the lead window.
    imminent: list[dict] = []
    for ev in events:
        start_raw = ev.get("start")
        if not start_raw or "T" not in start_raw:
            continue
        try:
            start = datetime.fromisoformat(start_raw.replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            continue
        if now <= start <= window_end:
            imminent.append(ev)

    if not imminent:
        return 0

    # Cheap thread context for matching, mirroring queue_meeting_prep_event.
    thread_rows = (
        await session.execute(
            select(UserMemory).where(
                UserMemory.user_id == user_id,
                UserMemory.memory_type == "story_thread",
            )
        )
    ).scalars().all()
    story_threads = [{"topic": t.key} for t in thread_rows]

    cutoff = now - timedelta(hours=24)
    queued = 0
    for ev in imminent:
        key = _meeting_thread_key(ev)
        existing = (
            await session.execute(
                select(ProactiveSurfacingEvent).where(
                    ProactiveSurfacingEvent.user_id == user_id,
                    ProactiveSurfacingEvent.event_type == "meeting_prep",
                    ProactiveSurfacingEvent.thread_key == key,
                    ProactiveSurfacingEvent.created_at >= cutoff,
                )
            )
        ).scalars().first()
        if existing:
            continue

        threads = _match_threads(ev, story_threads)
        when = ev.get("start_label") or "soon"
        attendees = ev.get("attendees") or []
        title = f"In {when}: {ev['title']}"
        parts = []
        if attendees:
            parts.append(f"with {', '.join(attendees[:3])}")
        if threads:
            parts.append(f"connects to your threads: {', '.join(threads)}")
        body = (
            f"You have '{ev['title']}' coming up {('— ' + '; '.join(parts)) if parts else 'shortly'}. "
            "Open Briefly for the prep."
        )

        session.add(
            ProactiveSurfacingEvent(
                user_id=user_id,
                event_type="meeting_prep",
                title=title[:200],
                body=body[:400],
                content_ids=[],
                thread_key=key,
                # High priority: imminent + matched threads break through context gates.
                priority=9 if threads else 8,
            )
        )
        queued += 1

    if queued:
        await session.flush()
        log.info("queue_imminent_meeting_prep: queued %d for user %s", queued, user_id)
    return queued
