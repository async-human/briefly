"""
Shared inbound email processing for SMTP and Resend webhooks.
"""
from __future__ import annotations

import hashlib
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import ContentStatus, RawContent, Source, SourceStatus, User

log = logging.getLogger(__name__)


def extract_token_from_address(address: str, ingestion_domain: str) -> str | None:
    try:
        local, domain = address.lower().split("@", 1)
        if domain == ingestion_domain.lower():
            return local
    except ValueError:
        pass
    return None


async def store_inbound_email(
    *,
    recipient_addresses: list[str],
    sender: str,
    subject: str,
    body_text: str,
    ingestion_domain: str,
    has_html: bool = False,
) -> int:
    """Store email for each valid recipient. Returns count of messages stored."""
    body = (body_text or "").strip()
    if not body:
        return 0

    content_hash = hashlib.sha256(body.encode()).hexdigest()
    stored = 0

    async with SessionLocal() as db:
        for rcpt in recipient_addresses:
            token = extract_token_from_address(rcpt, ingestion_domain)
            if not token:
                continue
            if await _store_for_user(
                db,
                token=token,
                sender=sender,
                subject=subject,
                body=body,
                content_hash=content_hash,
                has_html=has_html,
            ):
                stored += 1
        await db.commit()

    if stored:
        log.info("Inbound email stored from %s (subject=%r, recipients=%d)", sender, subject, stored)
    return stored


async def _store_for_user(
    db: AsyncSession,
    *,
    token: str,
    sender: str,
    subject: str,
    body: str,
    content_hash: str,
    has_html: bool,
) -> bool:
    result = await db.execute(
        select(User).where(User.email_token == token, User.is_active == True)
    )
    user = result.scalar_one_or_none()
    if not user:
        log.warning("Inbound email: no user for token %s", token)
        return False

    src_result = await db.execute(
        select(Source).where(
            Source.user_id == user.id,
            Source.source_type == "email",
            Source.identifier == sender.lower(),
        )
    )
    source = src_result.scalar_one_or_none()
    if not source:
        source = Source(
            user_id=user.id,
            source_type="email",
            identifier=sender.lower(),
            name=sender,
            status=SourceStatus.active,
        )
        db.add(source)
        await db.flush()

    existing_rc = await db.execute(
        select(RawContent).where(
            RawContent.source_id == source.id,
            RawContent.content_hash == content_hash,
        )
    )
    if existing_rc.scalar_one_or_none():
        return False

    db.add(
        RawContent(
            source_id=source.id,
            user_id=user.id,
            status=ContentStatus.pending,
            title=subject or "(no subject)",
            raw_text=body[:50_000],
            content_hash=content_hash,
            meta={"sender": sender, "subject": subject, "has_html": has_html},
        )
    )
    return True
