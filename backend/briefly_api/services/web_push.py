"""
briefly_api/services/web_push.py

Web Push (VAPID) delivery via pywebpush. One function the rest of the app calls:
`send_push_to_user(user_id, payload)`. Expired subscriptions (404/410) are pruned
automatically so the table stays clean.

payload keys: title (str), body (str), url (str, optional), tag (str, optional).
"""
from __future__ import annotations

import asyncio
import json
import logging

from sqlalchemy import delete, select

from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import PushSubscription

log = logging.getLogger(__name__)


def vapid_ready() -> bool:
    s = get_settings()
    return bool(s.web_push_enabled and s.vapid_private_key and s.vapid_public_key)


async def send_push_to_user(user_id: str, payload: dict) -> int:
    """Send a web-push to every subscription a user has. Returns the send count."""
    if not vapid_ready():
        log.info("web_push: VAPID not configured — skipping push for user %s", user_id)
        return 0

    s = get_settings()
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(PushSubscription).where(PushSubscription.user_id == user_id)
            )
        ).scalars().all()

    if not rows:
        return 0

    data = json.dumps(payload)
    sent = 0
    dead: list[str] = []

    for sub in rows:
        ok, gone = await asyncio.to_thread(
            _send_one, sub.endpoint, sub.p256dh, sub.auth, data, s
        )
        if ok:
            sent += 1
        elif gone:
            dead.append(sub.id)

    if dead:
        async with SessionLocal() as session:
            await session.execute(
                delete(PushSubscription).where(PushSubscription.id.in_(dead))
            )
            await session.commit()
        log.info("web_push: pruned %d expired subscriptions", len(dead))

    return sent


def _send_one(endpoint: str, p256dh: str, auth: str, data: str, s) -> tuple[bool, bool]:
    """Blocking pywebpush call (run in a thread). Returns (sent_ok, is_gone)."""
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        log.error("web_push: pywebpush not installed — run pip install -r requirements.txt")
        return False, False

    try:
        webpush(
            subscription_info={
                "endpoint": endpoint,
                "keys": {"p256dh": p256dh, "auth": auth},
            },
            data=data,
            vapid_private_key=s.vapid_private_key,
            vapid_claims={"sub": s.vapid_subject},
            timeout=10,
        )
        return True, False
    except WebPushException as e:  # type: ignore[misc]
        code = getattr(getattr(e, "response", None), "status_code", None)
        if code in (404, 410):
            return False, True  # subscription expired — prune it
        log.warning("web_push: send failed (status=%s): %s", code, e)
        return False, False
    except Exception:
        log.exception("web_push: unexpected send error")
        return False, False
