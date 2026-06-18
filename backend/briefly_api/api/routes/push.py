"""
briefly_api/api/routes/push.py

Web Push subscription management + a test trigger.

  GET  /push/vapid-key   → public VAPID key (frontend needs it to subscribe)
  POST /push/subscribe   → store a browser PushSubscription for the user
  POST /push/unsubscribe → remove a subscription
  POST /push/test        → send a test push to the current user (see-it-work)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import PushSubscription, User
from briefly_api.services.web_push import send_push_to_user

router = APIRouter(prefix="/push", tags=["push"])


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeBody(BaseModel):
    endpoint: str
    keys: PushKeys
    user_agent: str | None = None


class PushUnsubscribeBody(BaseModel):
    endpoint: str


@router.get("/vapid-key")
async def vapid_key(settings: Settings = Depends(get_settings)):
    return {
        "public_key": settings.vapid_public_key,
        "enabled": bool(settings.web_push_enabled and settings.vapid_public_key),
    }


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def subscribe(
    body: PushSubscribeBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = (
        await db.execute(
            select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)
        )
    ).scalar_one_or_none()

    if existing:
        existing.user_id = user.id
        existing.p256dh = body.keys.p256dh
        existing.auth = body.keys.auth
        existing.user_agent = body.user_agent
    else:
        db.add(
            PushSubscription(
                user_id=user.id,
                endpoint=body.endpoint,
                p256dh=body.keys.p256dh,
                auth=body.keys.auth,
                user_agent=body.user_agent,
            )
        )
    await db.commit()


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(
    body: PushUnsubscribeBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.user_id == user.id,
            PushSubscription.endpoint == body.endpoint,
        )
    )
    await db.commit()


@router.post("/test")
async def test_push(user: User = Depends(get_current_user)):
    sent = await send_push_to_user(
        user.id,
        {
            "title": "Briefly is on it 👀",
            "body": "Proactive notifications are live — this is a test ping.",
            "url": "/dashboard",
            "tag": "briefly-test",
        },
    )
    return {"sent": sent}


@router.post("/trigger-proactive")
async def trigger_proactive(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate this user's proactive events now (relevant content + meeting prep)
    and deliver any pending ones — so you can see a real alert without waiting for
    the morning scheduler."""
    from briefly_api.agents.proactive.proactive_surfacing import queue_relevant_content_event
    from briefly_api.services.calendar_briefing import queue_meeting_prep_event
    from briefly_api.services.proactive_notifier import send_pending_proactive_alerts

    queued = 0
    if await queue_relevant_content_event(db, user.id):
        queued += 1
    if await queue_meeting_prep_event(db, user.id):
        queued += 1
    await db.commit()

    delivered = await send_pending_proactive_alerts()
    return {"queued": queued, "delivered": delivered}
