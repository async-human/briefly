"""
Send proactive breaking-development emails (capped per user per day).

Separate from the morning digest — fires when high-priority events queue up.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import resend
from sqlalchemy import select

from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import ProactiveSurfacingEvent, User
from briefly_api.agents.proactive.proactive_surfacing import mark_surfaced
from briefly_api.services.web_push import send_push_to_user

log = logging.getLogger(__name__)

# Event types that warrant a real-time notification (not just digest injection).
_NOTIFY_TYPES = frozenset(
    {"breaking_development", "thread_update", "relevant_content", "meeting_prep", "voice_note_connection"}
)
# Email is reserved for high-priority events; web push goes to everything above
# settings.push_min_priority so it stays timely without flooding the inbox.
_EMAIL_MIN_PRIORITY = 8


def _event_url(event: ProactiveSurfacingEvent) -> str:
    if event.event_type == "relevant_content" and event.content_ids:
        first = event.content_ids[0]
        if isinstance(first, str) and first.startswith("http"):
            return first
    return "/dashboard"


async def send_pending_proactive_alerts() -> int:
    """Deliver unsurfaced proactive events via web push (+ email for high priority).

    Returns the number of events delivered. An event is marked surfaced once it
    has been delivered through at least one channel.
    """
    s = get_settings()
    if not s.proactive_surfacing_enabled:
        return 0

    sent = 0
    async with SessionLocal() as session:
        result = await session.execute(
            select(ProactiveSurfacingEvent, User.email, User.name)
            .join(User, User.id == ProactiveSurfacingEvent.user_id)
            .where(
                ProactiveSurfacingEvent.surfaced_at.is_(None),
                ProactiveSurfacingEvent.dismissed_at.is_(None),
                ProactiveSurfacingEvent.priority >= s.push_min_priority,
                ProactiveSurfacingEvent.event_type.in_(tuple(_NOTIFY_TYPES)),
            )
            .order_by(ProactiveSurfacingEvent.priority.desc())
            .limit(50)
        )
        rows = result.all()

    for event, email, name in rows:
        delivered = False

        # Web push — the primary real-time channel.
        try:
            pushed = await send_push_to_user(
                event.user_id,
                {
                    "title": event.title,
                    "body": event.body,
                    "url": _event_url(event),
                    "tag": f"briefly-{event.event_type}",
                },
            )
            if pushed:
                delivered = True
        except Exception:
            log.exception("ProactiveNotifier: push failed for event %s", event.id)

        # Email — only for high-priority events, and only if Resend is configured.
        if s.resend_api_key and event.priority >= _EMAIL_MIN_PRIORITY:
            try:
                if await _send_one(email, name, event.title, event.body):
                    delivered = True
            except Exception:
                log.exception("ProactiveNotifier: email failed for event %s", event.id)

        if delivered:
            async with SessionLocal() as session:
                await mark_surfaced(session, [event.id])
                await session.commit()
            sent += 1

    if sent:
        log.info("ProactiveNotifier: delivered %d proactive alert(s)", sent)
    return sent


async def _send_one(email: str, name: str | None, title: str, body: str) -> bool:
    s = get_settings()
    resend.api_key = s.resend_api_key
    greeting = name or "there"
    html = f"""<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8f8f8;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:28px;">
        <p style="margin:0 0 8px;font-size:11px;color:#5b47e0;letter-spacing:1px;text-transform:uppercase;font-weight:700;">Briefly alert</p>
        <h1 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">{_esc(title)}</h1>
        <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.6;">Hey {_esc(greeting)},</p>
        <p style="margin:0 0 24px;font-size:15px;color:#333;line-height:1.65;">{_esc(body)}</p>
        <a href="{s.frontend_url.rstrip('/')}/dashboard" style="display:inline-block;background:#5b47e0;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-size:14px;">Open Briefly</a>
      </div></body></html>"""

    try:
        await asyncio.wait_for(
            asyncio.to_thread(
                resend.Emails.send,
                {
                    "from": f"{s.digest_from_name} <{s.digest_from_email}>",
                    "to": [email],
                    "subject": f"Briefly: {_esc(title)[:80]}",
                    "html": html,
                },
            ),
            timeout=20.0,
        )
        return True
    except Exception:
        log.exception("ProactiveNotifier: Resend failed for %s", email)
        return False


def _esc(text: str) -> str:
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
