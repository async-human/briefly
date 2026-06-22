"""
briefly_api/services/voice_briefing.py

Jarvis-style proactive voice. Briefly reaches out *first* — not just in text, but
spoken aloud. Given a user's pending proactive events, compose a short, natural
spoken briefing in the Briefly chief-of-staff persona and synthesize it via the
provider-agnostic TTS adapter.

This rides the existing surfaces (web push + the orb): the push payload carries a
`voice` flag and the client fetches `/proactive/voice` to play it. No telephony.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select

from briefly_api.agents.proactive.proactive_surfacing import get_for_api
from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import ProactiveSurfacingEvent, User
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.proactive_gate import should_push
from briefly_api.tts.adapter import get_tts_adapter

log = logging.getLogger(__name__)


def _fallback_script(events: list[dict], first_name: str | None) -> str:
    """Deterministic spoken script when the LLM is unavailable — never silent."""
    who = f" {first_name}" if first_name else ""
    if not events:
        return f"Hi{who}, it's Briefly. Nothing urgent right now — you're all caught up."
    if len(events) == 1:
        e = events[0]
        return f"Hi{who}, it's Briefly. {e.get('title', '').strip()}. {e.get('body', '').strip()}"
    lead = f"Hi{who}, it's Briefly. A couple of things worth your attention. "
    items = ". ".join(e.get("title", "").strip() for e in events[:3] if e.get("title"))
    return lead + items + "."


async def build_voice_script(events: list[dict], first_name: str | None) -> str:
    """Compose a short, spoken-style proactive briefing in the Briefly persona."""
    s = get_settings()
    if not events:
        return _fallback_script(events, first_name)

    lines = []
    for e in events[:4]:
        title = (e.get("title") or "").strip()
        body = (e.get("body") or "").strip()
        if title:
            lines.append(f"- {title}" + (f": {body}" if body else ""))
    bullets = "\n".join(lines)

    name_hint = f"The person's first name is {first_name}. Use it once, naturally." if first_name else ""
    prompt = (
        f"{name_hint}\n"
        "Turn these proactive alerts into ONE short spoken briefing — what you'd say "
        "out loud if you called them for fifteen seconds. Lead with the single most "
        "important thing. No lists, no markdown, no greetings beyond a brief opener. "
        f"Hard limit: {s.proactive_voice_max_chars} characters.\n\n"
        f"Alerts:\n{bullets}"
    )

    try:
        llm = get_llm_adapter(s)
        resp = await llm.complete(
            messages=[Message(role="user", content=prompt)],
            system=s.proactive_voice_persona,
            temperature=0.5,
            max_tokens=320,
            agent="proactive_voice",
        )
        script = (resp.content or "").strip()
        if script:
            return script[: s.proactive_voice_max_chars]
    except Exception:
        log.exception("build_voice_script: LLM failed — using fallback")

    return _fallback_script(events, first_name)


async def synthesize_proactive_voice(user_id: str) -> tuple[str, bytes, str] | None:
    """
    Build and synthesize the user's current proactive voice briefing.

    Returns (script, audio_bytes, content_type), or None if voice is disabled,
    TTS is unavailable, or synthesis produced nothing.
    """
    s = get_settings()
    if not s.proactive_voice_enabled:
        return None

    tts = get_tts_adapter(s)
    if not tts.enabled:
        return None

    async with SessionLocal() as session:
        events = await get_for_api(session, user_id)
        user = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()

    first_name = None
    if user and user.name:
        first_name = user.name.strip().split(" ")[0] or None

    script = await build_voice_script(events, first_name)
    if not script:
        return None

    try:
        audio = await tts.synthesize(script)
    except Exception:
        log.exception("synthesize_proactive_voice: TTS failed for user %s", user_id)
        return None

    if not audio:
        return None
    return script, audio, tts.content_type()


async def build_orb_proactive_voice(user_id: str) -> dict:
    """
    Decide whether the always-on desktop orb should speak up right now, and what
    to say. Applies the SAME context gate as the push notifier (quiet hours, in a
    meeting, "afraid to miss" boost) so the orb only interrupts when appropriate.

    Returns {"speak": bool, "script": str | None, "event_ids": [str]}.
    """
    s = get_settings()
    if not (s.proactive_surfacing_enabled and s.proactive_voice_enabled):
        return {"speak": False, "script": None, "event_ids": []}

    # Lazy import avoids a circular import (proactive_notifier imports this module
    # indirectly through the gate at call time, not import time).
    from briefly_api.services.proactive_notifier import _NOTIFY_TYPES

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=48)
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(ProactiveSurfacingEvent)
                .where(
                    ProactiveSurfacingEvent.user_id == user_id,
                    # pushed_at gates against re-interrupting: whichever realtime
                    # channel (web push or orb) speaks first marks it.
                    ProactiveSurfacingEvent.pushed_at.is_(None),
                    ProactiveSurfacingEvent.surfaced_at.is_(None),
                    ProactiveSurfacingEvent.dismissed_at.is_(None),
                    ProactiveSurfacingEvent.created_at >= cutoff,
                    ProactiveSurfacingEvent.priority >= s.push_min_priority,
                    ProactiveSurfacingEvent.event_type.in_(tuple(_NOTIFY_TYPES)),
                    or_(
                        ProactiveSurfacingEvent.snoozed_until.is_(None),
                        ProactiveSurfacingEvent.snoozed_until <= now,
                    ),
                )
                .order_by(ProactiveSurfacingEvent.priority.desc())
                .limit(10)
            )
        ).scalars().all()

        user = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()

    # Context gate per event — only speak the ones that pass right now.
    ready = [
        e
        for e in rows
        if await should_push(
            user_id,
            e.priority,
            topic_text=" ".join(filter(None, [e.title, e.body, e.thread_key])),
        )
        == "push"
    ]
    if not ready:
        return {"speak": False, "script": None, "event_ids": []}

    first_name = None
    if user and user.name:
        first_name = user.name.strip().split(" ")[0] or None

    events = [{"title": e.title, "body": e.body} for e in ready]
    script = await build_voice_script(events, first_name)
    return {"speak": True, "script": script, "event_ids": [e.id for e in ready]}
