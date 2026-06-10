"""Meeting-aware briefing context from Google Calendar."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from briefly_api.auth.calendar import (
    CALENDAR_API,
    get_calendar_connection,
    refresh_calendar_access_token,
)
from briefly_api.config import get_settings

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

    params = {
        "timeMin": start.isoformat(),
        "timeMax": end.isoformat(),
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": 12,
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
        events.append(
            {
                "title": (ev.get("summary") or "Untitled meeting").strip(),
                "start": start_raw,
                "start_label": _format_time(start_raw, tz) if "T" in start_raw else "All day",
                "attendees": attendees[:6],
                "description": (ev.get("description") or "")[:300],
            }
        )
    return events


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
                "attendees": ev.get("attendees") or [],
                "relevant_stories": [],
                "active_threads": [],
            }
            for ev in events[:4]
        ]

    summary_lines = []
    for m in meetings[:4]:
        line = f"- {m['time']}: {m['title']}"
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
) -> dict | None:
    connection = await get_calendar_connection(session, user_id)
    if not connection:
        return None

    settings = get_settings()
    try:
        access_token = await refresh_calendar_access_token(connection, settings)
        events = await fetch_todays_events(access_token, timezone_str, run_date)
    except Exception:
        log.debug("Calendar briefing load failed for user %s", user_id, exc_info=True)
        return None

    return build_meeting_briefing(events, enriched_items, selected_item_ids, story_threads)
