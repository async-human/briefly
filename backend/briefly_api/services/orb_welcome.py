"""Personalized orb greeting when a voice session starts."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import pytz
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.db.models import User
from briefly_api.services.calendar_briefing import load_upcoming_meetings
from briefly_api.utils.dates import local_date_string

log = logging.getLogger(__name__)


def _first_name(user: User | None) -> str | None:
    if not user or not user.name:
        return None
    part = user.name.strip().split(" ")[0]
    return part or None


def _time_greeting(tz_name: str) -> str:
    try:
        tz = pytz.timezone(tz_name or "UTC")
    except Exception:
        tz = pytz.UTC
    hour = datetime.now(timezone.utc).astimezone(tz).hour
    if hour < 12:
        return "Good morning"
    if hour < 17:
        return "Good afternoon"
    return "Good evening"


async def build_orb_welcome(db: AsyncSession, user_id: str) -> dict:
    """Return a spoken greeting script and whether the client should open the mic."""
    result = await db.execute(
        select(User).options(selectinload(User.profile)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        return {"speak": False, "script": None, "open_listen": False, "user_name": None}

    profile = user.profile
    tz = getattr(profile, "digest_timezone", None) or "UTC"
    name = _first_name(user)
    greet = _time_greeting(tz)
    today = local_date_string(tz)

    who = f", {name}" if name else ""
    lines = [
        f"{greet}{who}. I'm Briefly — your voice assistant.",
        f"Today is {datetime.strptime(today, '%Y-%m-%d').strftime('%A, %B %d')} in your timezone.",
        "You can ask about your briefing, calendar, email, the web, or anything in your library.",
        "What would you like to know?",
    ]

    try:
        cal = await load_upcoming_meetings(db, user_id)
        summary = (cal or {}).get("summary_text") or ""
        if summary and len(summary) > 20:
            short = summary.split(".")[0].strip()
            if short:
                lines.insert(3, f"Quick heads-up: {short}.")
    except Exception:
        log.debug("welcome calendar snippet skipped", exc_info=True)

    script = " ".join(lines)
    return {
        "speak": True,
        "script": script,
        "open_listen": True,
        "user_name": name,
    }
