"""
Inbound webhooks (Resend email.received, etc.)
"""
from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status

from briefly_api.config import Settings, get_settings
from briefly_api.ingestion.inbound_email import store_inbound_email

router = APIRouter(tags=["webhooks"])
log = logging.getLogger(__name__)


def _verify_resend_signature(body: bytes, signature: str | None, secret: str) -> bool:
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/webhooks/resend/inbound")
async def resend_inbound_email(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    Resend inbound email webhook (email.received).
    Configure in Resend dashboard → point to {BACKEND_URL}/api/v1/webhooks/resend/inbound
    """
    if settings.inbound_email_mode not in ("webhook", "both"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook ingestion disabled")

    raw = await request.body()
    sig = request.headers.get("resend-signature") or request.headers.get("x-resend-signature")
    secret = (settings.resend_inbound_webhook_secret or "").strip()
    if secret:
        if not _verify_resend_signature(raw, sig, secret):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")
    elif settings.app_env == "production":
        log.warning("RESEND_INBOUND_WEBHOOK_SECRET unset — inbound webhook signatures not verified")

    import json

    try:
        payload = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON") from exc

    event_type = payload.get("type") or payload.get("event")
    data = payload.get("data") or payload

    if event_type and event_type not in ("email.received", "inbound.email.received"):
        return {"ok": True, "ignored": True}

    recipients = data.get("to") or data.get("recipients") or []
    if isinstance(recipients, str):
        recipients = [recipients]

    sender = data.get("from") or data.get("sender") or ""
    subject = data.get("subject") or "(no subject)"
    text = data.get("text") or data.get("plain") or ""
    html = data.get("html") or ""

    stored = await store_inbound_email(
        recipient_addresses=recipients,
        sender=sender,
        subject=subject,
        body_text=text or html,
        ingestion_domain=settings.email_ingestion_domain,
        has_html=bool(html),
    )
    return {"ok": True, "stored": stored}
