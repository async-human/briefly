"""
Orb context engineering — structured slots + conversation memory for tool follow-ups.

Resolves elliptical voice follow-ups ("any chance of rain?") by layering:
  1. Explicit args / current transcript
  2. Session tool slots (last successful tool entities)
  3. Recent FollowUpThread messages (user + assistant)
  4. Session last transcript / last answer
  5. User profile defaults
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import FollowUpThread
from briefly_api.services.orb_session import OrbSessionState

_MAX_THREAD_MESSAGES = 8

# Spoken weather answers: "In Pune, India, it's ..."
_ASSISTANT_PLACE_RE = re.compile(
    r"\bIn\s+([A-Za-z][A-Za-z\s\-']+?)(?:,\s*[A-Za-z][A-Za-z\s\-']+)?\s*,\s*it(?:'s| is)\b",
    re.IGNORECASE,
)

_TRANSCRIPT_LOCATION_RES = [
    re.compile(r"\bweather(?:\s+like)?\s+(?:in|for|at)\s+(.+?)(?:\?|$)", re.IGNORECASE),
    re.compile(r"\b(?:forecast|temperature|rain|humidity)\s+(?:in|for|at)\s+(.+?)(?:\?|$)", re.IGNORECASE),
    re.compile(r"\bhow(?:'s| is)\s+the\s+weather\s+(?:in|at)\s+(.+?)(?:\?|$)", re.IGNORECASE),
    re.compile(r"\b(?:in|at|for)\s+([A-Z][A-Za-z\s\-']{2,40}?)(?:\?|$|\.)", re.IGNORECASE),
]

_RAIN_QUERY_RE = re.compile(r"\b(rain|rainy|drizzle|shower|precipitation|umbrella)\b", re.IGNORECASE)


@dataclass
class OrbToolContext:
    """Resolved context passed into orb tool handlers."""

    session: OrbSessionState | None = None
    thread_messages: list[dict[str, Any]] = field(default_factory=list)
    tool_slots: dict[str, Any] = field(default_factory=dict)
    profile_meta: dict[str, Any] = field(default_factory=dict)
    last_tool: str | None = None
    last_transcript: str | None = None
    last_answer: str | None = None

    @classmethod
    def empty(cls) -> OrbToolContext:
        return cls()


async def load_orb_tool_context(
    db: AsyncSession | None,
    user_id: str | None,
    session: OrbSessionState | None,
    thread_id: str | None,
    *,
    profile_meta: dict[str, Any] | None = None,
) -> OrbToolContext:
    """Load session slots + recent thread messages for tool execution."""
    ctx = OrbToolContext(
        session=session,
        tool_slots=dict(getattr(session, "tool_slots", None) or {}),
        profile_meta=dict(profile_meta or {}),
        last_tool=session.last_tool if session else None,
        last_transcript=session.last_transcript if session else None,
        last_answer=getattr(session, "last_answer", None) if session else None,
    )
    if not db or not user_id or not thread_id:
        return ctx

    result = await db.execute(
        select(FollowUpThread).where(
            FollowUpThread.id == thread_id,
            FollowUpThread.user_id == user_id,
        )
    )
    thread = result.scalar_one_or_none()
    if thread and thread.messages:
        ctx.thread_messages = list(thread.messages)[-_MAX_THREAD_MESSAGES:]
    return ctx


def _clean_location(raw: str) -> str:
    loc = (raw or "").strip().rstrip(".,!?")
    loc = re.sub(r"\s+", " ", loc)
    # Drop trailing filler from partial STT ("Pune today", "Pune right now")
    loc = re.sub(
        r"\s+(today|tonight|tomorrow|now|right now|please|thanks)\s*$",
        "",
        loc,
        flags=re.IGNORECASE,
    ).strip()
    return loc


def _location_from_text(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return ""
    for pat in _TRANSCRIPT_LOCATION_RES:
        m = pat.search(t)
        if m:
            loc = _clean_location(m.group(1))
            if loc and len(loc) >= 2:
                return loc
    m = _ASSISTANT_PLACE_RE.search(t)
    if m:
        return _clean_location(m.group(1))
    return ""


def _location_from_conversation(ctx: OrbToolContext) -> str:
    """Walk recent messages newest-first for the last mentioned place."""
    for msg in reversed(ctx.thread_messages):
        role = msg.get("role")
        content = str(msg.get("content") or "")
        if role not in ("user", "assistant"):
            continue
        loc = _location_from_text(content)
        if loc:
            return loc
    if ctx.last_answer:
        loc = _location_from_text(ctx.last_answer)
        if loc:
            return loc
    if ctx.last_transcript:
        loc = _location_from_text(ctx.last_transcript)
        if loc:
            return loc
    return ""


def resolve_weather_location(
    transcript: str,
    args: dict | None,
    ctx: OrbToolContext | None,
) -> str:
    """Layered location resolution for weather follow-ups."""
    from briefly_api.services.weather import extract_weather_location

    if args and args.get("location"):
        return str(args["location"]).strip()

    direct = extract_weather_location(transcript, None, ctx.profile_meta if ctx else {})
    if direct:
        return direct

    if ctx:
        slot_loc = str((ctx.tool_slots.get("weather") or {}).get("location") or "").strip()
        if slot_loc:
            return slot_loc
        conv_loc = _location_from_conversation(ctx)
        if conv_loc:
            return conv_loc

    return extract_weather_location(transcript, args, ctx.profile_meta if ctx else {})


def transcript_asks_about_rain(transcript: str) -> bool:
    return bool(_RAIN_QUERY_RE.search(transcript or ""))


def update_tool_slots_from_turn(
    state: OrbSessionState,
    tool_name: str | None,
    transcript: str,
    answer: str,
) -> None:
    """Persist structured entities from a completed tool turn into session slots."""
    if not tool_name:
        return
    slots = dict(state.tool_slots or {})

    if tool_name == "weather":
        loc = _location_from_text(transcript)
        if not loc and answer:
            loc = _location_from_text(answer)
        if loc:
            slots["weather"] = {"location": loc}

    elif tool_name == "gmail_search":
        from briefly_api.services.gmail_read import extract_gmail_search_query

        query = extract_gmail_search_query(transcript, None)
        if query:
            slots["gmail_search"] = {"query": query}

    elif tool_name == "calendar_upcoming":
        slots["calendar_upcoming"] = {"active": True}

    if slots != state.tool_slots:
        state.tool_slots = slots


def compact_context_blurb(ctx: OrbToolContext, tool_name: str) -> str:
    """Short system-facing summary for agent / logging."""
    parts: list[str] = []
    if ctx.last_tool:
        parts.append(f"last_tool={ctx.last_tool}")
    if ctx.last_transcript:
        parts.append(f"last_user={ctx.last_transcript[:120]!r}")
    slot = ctx.tool_slots.get(tool_name) or {}
    if slot:
        parts.append(f"slots={slot}")
    if ctx.thread_messages:
        parts.append(f"thread_turns={len(ctx.thread_messages)}")
    return "; ".join(parts) if parts else ""
