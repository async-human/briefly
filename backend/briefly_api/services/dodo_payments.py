"""Dodo Payments — checkout sessions and webhook verification."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from typing import Any

import httpx

from briefly_api.config import Settings

log = logging.getLogger(__name__)

_UPGRADE_EVENTS = frozenset({
    "subscription.active",
    "subscription.renewed",
    "subscription.plan_changed",
})
_DOWNGRADE_EVENTS = frozenset({
    "subscription.cancelled",
    "subscription.expired",
    "subscription.failed",
})


def dodo_api_base(settings: Settings) -> str:
    if settings.dodo_payments_env == "live_mode":
        return "https://live.dodopayments.com"
    return "https://test.dodopayments.com"


def product_id_for_plan(settings: Settings, plan: str) -> str:
    if plan == "yearly":
        pid = settings.dodo_pro_yearly_product_id.strip()
        if not pid:
            raise ValueError("Yearly Pro product is not configured.")
        return pid
    pid = settings.dodo_pro_monthly_product_id.strip()
    if not pid:
        raise ValueError("Monthly Pro product is not configured.")
    return pid


async def create_checkout_session(
    settings: Settings,
    *,
    user_id: str,
    email: str,
    name: str | None,
    plan: str,
) -> dict[str, str]:
    if not settings.dodo_payments_api_key.strip():
        raise ValueError("Dodo Payments is not configured.")

    product_id = product_id_for_plan(settings, plan)
    return_url = f"{settings.frontend_url.rstrip('/')}/settings?checkout=success"

    payload: dict[str, Any] = {
        "product_cart": [{"product_id": product_id, "quantity": 1}],
        "return_url": return_url,
        "metadata": {"briefly_user_id": user_id},
    }
    if email:
        payload["customer"] = {"email": email, "name": name or email.split("@")[0]}

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{dodo_api_base(settings)}/checkouts",
            headers={
                "Authorization": f"Bearer {settings.dodo_payments_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if resp.status_code >= 400:
            log.warning("Dodo checkout failed (%s): %s", resp.status_code, resp.text[:500])
            resp.raise_for_status()
        data = resp.json()

    checkout_url = data.get("checkout_url") or data.get("url")
    if not checkout_url:
        raise ValueError("Dodo did not return a checkout URL.")
    return {
        "checkout_url": checkout_url,
        "session_id": str(data.get("session_id") or data.get("id") or ""),
    }


# Dodo CancellationFeedback enum values
CANCELLATION_FEEDBACK_VALUES = frozenset({
    "too_expensive",
    "missing_features",
    "switched_service",
    "unused",
    "customer_service",
    "low_quality",
    "too_complex",
    "other",
})


async def cancel_subscription(
    settings: Settings,
    subscription_id: str,
    *,
    feedback: str | None = None,
    comment: str | None = None,
    immediate: bool = False,
) -> dict[str, Any]:
    if not settings.dodo_payments_api_key.strip():
        raise ValueError("Dodo Payments is not configured.")

    payload: dict[str, Any] = {"cancel_reason": "cancelled_by_customer"}
    if feedback and feedback in CANCELLATION_FEEDBACK_VALUES:
        payload["cancellation_feedback"] = feedback
    if comment and comment.strip():
        payload["cancellation_comment"] = comment.strip()[:2000]

    if immediate or settings.dodo_payments_env == "test_mode":
        payload["status"] = "cancelled"
    else:
        payload["cancel_at_next_billing_date"] = True

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.patch(
            f"{dodo_api_base(settings)}/subscriptions/{subscription_id}",
            headers={
                "Authorization": f"Bearer {settings.dodo_payments_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if resp.status_code >= 400:
            log.warning(
                "Dodo cancel failed (%s) sub=%s: %s",
                resp.status_code,
                subscription_id,
                resp.text[:500],
            )
            resp.raise_for_status()
        data = resp.json()

    ends_immediately = bool(immediate or settings.dodo_payments_env == "test_mode")
    return {"subscription": data, "ends_immediately": ends_immediately}


def verify_webhook_signature(
    settings: Settings,
    body: bytes,
    webhook_id: str | None,
    webhook_timestamp: str | None,
    webhook_signature: str | None,
) -> None:
    secret = settings.dodo_payments_webhook_key.strip()
    if not secret:
        if settings.app_env == "production":
            raise ValueError("Webhook secret not configured")
        log.warning("DODO_PAYMENTS_WEBHOOK_KEY unset — skipping signature verification")
        return
    if not webhook_id or not webhook_timestamp or not webhook_signature:
        raise ValueError("Missing webhook signature headers")

    if secret.startswith("whsec_"):
        key = base64.b64decode(secret[6:])
    else:
        key = secret.encode()

    signed_content = f"{webhook_id}.{webhook_timestamp}.{body.decode('utf-8')}"
    expected = base64.b64encode(
        hmac.new(key, signed_content.encode("utf-8"), hashlib.sha256).digest()
    ).decode()

    valid = False
    for entry in webhook_signature.split():
        if "," not in entry:
            continue
        version, sig = entry.split(",", 1)
        if version == "v1" and hmac.compare_digest(sig.strip(), expected):
            valid = True
            break
    if not valid:
        raise ValueError("Invalid webhook signature")


def parse_webhook_event(body: bytes) -> dict[str, Any]:
    return json.loads(body.decode("utf-8"))


def event_type(event: dict[str, Any]) -> str:
    return str(event.get("type") or event.get("event_type") or "")


def is_upgrade_event(event_type_name: str) -> bool:
    return event_type_name in _UPGRADE_EVENTS


def is_downgrade_event(event_type_name: str) -> bool:
    return event_type_name in _DOWNGRADE_EVENTS


def extract_billing_identity(event: dict[str, Any]) -> tuple[str | None, str | None, str | None, str | None]:
    """Return (user_id, email, customer_id, subscription_id)."""
    data = event.get("data") or {}
    if not isinstance(data, dict):
        data = {}

    metadata = data.get("metadata") or event.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}

    user_id = metadata.get("briefly_user_id")
    if user_id is not None:
        user_id = str(user_id)

    customer = data.get("customer") or {}
    if not isinstance(customer, dict):
        customer = {}

    email = (
        customer.get("email")
        or data.get("customer_email")
        or data.get("email")
        or event.get("customer_email")
    )
    if email is not None:
        email = str(email).strip().lower()

    customer_id = customer.get("customer_id") or customer.get("id") or data.get("customer_id")
    if customer_id is not None:
        customer_id = str(customer_id)

    subscription_id = data.get("subscription_id") or data.get("id")
    if subscription_id is not None:
        subscription_id = str(subscription_id)

    return user_id, email, customer_id, subscription_id
