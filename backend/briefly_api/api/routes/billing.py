from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])

FOUNDING_CAP_REACHED_MSG = "Founding member cap reached — user subscribed as standard Pro"


def _verify_signature(body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def _count_founding_members(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count()).select_from(User).where(User.is_founding_member.is_(True))
    )
    return result.scalar() or 0


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def lemon_squeezy_webhook(
    request: Request,
    x_signature: str = Header(..., alias="X-Signature"),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    body = await request.body()

    if settings.lemon_squeezy_webhook_secret:
        if not _verify_signature(body, x_signature, settings.lemon_squeezy_webhook_secret):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")

    payload = await request.json()
    event_name: str = payload.get("meta", {}).get("event_name", "")

    if event_name == "subscription_created":
        await _handle_subscription_created(payload, db, settings)
    elif event_name in ("subscription_expired",):
        await _handle_subscription_expired(payload, db)
    else:
        logger.debug("Unhandled Lemon Squeezy event: %s", event_name)

    return {"ok": True}


async def _handle_subscription_created(
    payload: dict, db: AsyncSession, settings: Settings
) -> None:
    attrs = payload.get("data", {}).get("attributes", {})
    email: str = attrs.get("user_email", "")
    ls_customer_id: str = str(attrs.get("customer_id", ""))
    ls_subscription_id: str = str(payload.get("data", {}).get("id", ""))

    if not email:
        logger.warning("subscription_created event missing user_email")
        return

    user = await _get_user_by_email(db, email)
    if not user:
        logger.warning("subscription_created: no user found for email %s", email)
        return

    if user.plan == "pro":
        # Idempotent — already upgraded
        return

    founding_count = await _count_founding_members(db)
    is_founding = founding_count < settings.founding_member_cap

    user.plan = "pro"
    user.is_founding_member = is_founding
    user.ls_customer_id = ls_customer_id
    user.ls_subscription_id = ls_subscription_id
    user.subscribed_at = datetime.now(timezone.utc)

    await db.commit()

    if is_founding:
        logger.info("User %s upgraded to Pro as founding member (%d/%d)", email, founding_count + 1, settings.founding_member_cap)
    else:
        logger.info("%s — user %s upgraded to standard Pro", FOUNDING_CAP_REACHED_MSG, email)


async def _handle_subscription_expired(payload: dict, db: AsyncSession) -> None:
    attrs = payload.get("data", {}).get("attributes", {})
    email: str = attrs.get("user_email", "")

    if not email:
        logger.warning("subscription_expired event missing user_email")
        return

    user = await _get_user_by_email(db, email)
    if not user:
        logger.warning("subscription_expired: no user found for email %s", email)
        return

    if user.plan == "free":
        return

    user.plan = "free"
    await db.commit()
    logger.info("User %s downgraded to free (subscription expired)", email)
