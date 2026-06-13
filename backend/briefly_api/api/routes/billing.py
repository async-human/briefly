from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.api.plan_limits import (
    FREE_DIGEST_ITEMS,
    FREE_HISTORY_DAYS,
    FREE_SOURCE_LIMIT,
    count_billable_sources,
    has_pro_access,
)
from briefly_api.api.schemas import BillingStatusOut, CheckoutIn, CheckoutOut
from briefly_api.auth.deps import get_current_user
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import User
from briefly_api.services import dodo_payments

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])

FOUNDING_CAP_REACHED_MSG = "Founding member cap reached — user subscribed as standard Pro"


def _verify_lemon_signature(body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def _get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def _count_founding_members(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count()).select_from(User).where(User.is_founding_member.is_(True))
    )
    return result.scalar() or 0


async def _upgrade_user_to_pro(
    user: User,
    db: AsyncSession,
    settings: Settings,
    *,
    customer_id: str | None = None,
    subscription_id: str | None = None,
) -> None:
    if user.plan == "pro":
        if customer_id:
            user.ls_customer_id = customer_id
        if subscription_id:
            user.ls_subscription_id = subscription_id
        await db.commit()
        return

    founding_count = await _count_founding_members(db)
    is_founding = founding_count < settings.founding_member_cap

    user.plan = "pro"
    if is_founding:
        user.is_founding_member = True
    if customer_id:
        user.ls_customer_id = customer_id
    if subscription_id:
        user.ls_subscription_id = subscription_id
    if not user.subscribed_at:
        user.subscribed_at = datetime.now(timezone.utc)

    await db.commit()

    if is_founding:
        logger.info(
            "User %s upgraded to Pro as founding member (%d/%d)",
            user.email,
            founding_count + 1,
            settings.founding_member_cap,
        )
    else:
        logger.info("User %s upgraded to Pro", user.email)


async def _downgrade_user_to_free(user: User, db: AsyncSession) -> None:
    if user.plan == "free":
        return
    user.plan = "free"
    await db.commit()
    logger.info("User %s downgraded to free", user.email)


async def _plan_usage_for_user(db: AsyncSession, user: User) -> dict:
    sources_used = await count_billable_sources(db, user.id)
    pro = has_pro_access(user)
    if pro:
        return {
            "sources_used": sources_used,
            "sources_limit": None,
            "sources_at_limit": False,
            "history_days_limit": None,
            "digest_items_limit": None,
            "free_limits_reached": False,
        }

    sources_at_limit = sources_used >= FREE_SOURCE_LIMIT
    return {
        "sources_used": sources_used,
        "sources_limit": FREE_SOURCE_LIMIT,
        "sources_at_limit": sources_at_limit,
        "history_days_limit": FREE_HISTORY_DAYS,
        "digest_items_limit": FREE_DIGEST_ITEMS,
        "free_limits_reached": sources_at_limit,
    }


@router.get("/status", response_model=BillingStatusOut)
async def billing_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BillingStatusOut:
    usage = await _plan_usage_for_user(db, user)
    return BillingStatusOut(
        plan=user.plan,
        is_founding_member=bool(user.is_founding_member),
        is_pro=has_pro_access(user),
        subscribed_at=user.subscribed_at,
        usage=usage,
    )


@router.post("/checkout", response_model=CheckoutOut)
async def create_checkout(
    body: CheckoutIn,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> CheckoutOut:
    if has_pro_access(user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have Pro.",
        )
    try:
        result = await dodo_payments.create_checkout_session(
            settings,
            user_id=user.id,
            email=user.email,
            name=user.name,
            plan=body.plan,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Dodo checkout failed for user %s", user.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not start checkout. Try again in a moment.",
        ) from exc
    return CheckoutOut(**result)


@router.post("/dodo/webhook", status_code=status.HTTP_200_OK)
async def dodo_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    body = await request.body()
    webhook_id = request.headers.get("webhook-id")
    webhook_timestamp = request.headers.get("webhook-timestamp")
    webhook_signature = request.headers.get("webhook-signature")

    try:
        dodo_payments.verify_webhook_signature(
            settings,
            body,
            webhook_id,
            webhook_timestamp,
            webhook_signature,
        )
        event = dodo_payments.parse_webhook_event(body)
    except ValueError as exc:
        logger.warning("Dodo webhook rejected: %s", exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    event_type_name = dodo_payments.event_type(event)
    user_id, email, customer_id, subscription_id = dodo_payments.extract_billing_identity(event)

    user: User | None = None
    if user_id:
        user = await _get_user_by_id(db, user_id)
    if not user and email:
        user = await _get_user_by_email(db, email)

    if not user:
        logger.warning("Dodo webhook %s: no user for email=%s user_id=%s", event_type_name, email, user_id)
        return {"ok": True, "ignored": "user_not_found"}

    if dodo_payments.is_upgrade_event(event_type_name):
        await _upgrade_user_to_pro(
            user,
            db,
            settings,
            customer_id=customer_id,
            subscription_id=subscription_id,
        )
    elif dodo_payments.is_downgrade_event(event_type_name):
        await _downgrade_user_to_free(user, db)
    else:
        logger.debug("Unhandled Dodo webhook event: %s", event_type_name)

    return {"ok": True}


# ── Legacy Lemon Squeezy webhook (kept for existing subscribers) ───────────────

@router.post("/webhook", status_code=status.HTTP_200_OK)
async def lemon_squeezy_webhook(
    request: Request,
    x_signature: str = Header(..., alias="X-Signature"),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    body = await request.body()

    if not settings.lemon_squeezy_webhook_secret:
        if settings.app_env == "production":
            logger.error("Billing webhook called but LEMON_SQUEEZY_WEBHOOK_SECRET is unset — rejecting")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Billing webhook not configured",
            )
        logger.warning("LEMON_SQUEEZY_WEBHOOK_SECRET unset — accepting unsigned webhook (non-production only)")
    elif not _verify_lemon_signature(body, x_signature, settings.lemon_squeezy_webhook_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")

    payload = await request.json()
    event_name: str = payload.get("meta", {}).get("event_name", "")

    if event_name == "subscription_created":
        await _handle_lemon_subscription_created(payload, db, settings)
    elif event_name in ("subscription_expired",):
        await _handle_lemon_subscription_expired(payload, db)
    else:
        logger.debug("Unhandled Lemon Squeezy event: %s", event_name)

    return {"ok": True}


async def _handle_lemon_subscription_created(
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

    await _upgrade_user_to_pro(
        user,
        db,
        settings,
        customer_id=ls_customer_id,
        subscription_id=ls_subscription_id,
    )


async def _handle_lemon_subscription_expired(payload: dict, db: AsyncSession) -> None:
    attrs = payload.get("data", {}).get("attributes", {})
    email: str = attrs.get("user_email", "")

    if not email:
        logger.warning("subscription_expired event missing user_email")
        return

    user = await _get_user_by_email(db, email)
    if not user:
        logger.warning("subscription_expired: no user found for email %s", email)
        return

    await _downgrade_user_to_free(user, db)
