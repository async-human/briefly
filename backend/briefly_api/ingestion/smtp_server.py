"""
briefly_api/ingestion/smtp_server.py

Inbound SMTP server for newsletter ingestion.

Each user gets a unique catch-all address: {email_token}@{ingestion_domain}
When an email arrives, this server:
  1. Parses the recipient to find the owning user.
  2. Creates a Source record for the sender (type=email) if one doesn't exist.
  3. Stores the email as RawContent so it can be included in the next briefing.

Run alongside the FastAPI app — started as an asyncio task in main.py.
"""
from __future__ import annotations

import asyncio
import email as email_lib
import hashlib
import logging
from email.headerregistry import Address

from aiosmtpd.controller import Controller
from aiosmtpd.smtp import SMTP as SMTPServer, Envelope, Session
from sqlalchemy import select

from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import ContentStatus, RawContent, Source, SourceStatus, User

log = logging.getLogger(__name__)


def _extract_token(rcpt_address: str, ingestion_domain: str) -> str | None:
    try:
        local, domain = rcpt_address.lower().split("@", 1)
        if domain == ingestion_domain.lower():
            return local
    except ValueError:
        pass
    return None


def _parse_body(msg: email_lib.message.Message) -> tuple[str, str]:
    """Return (plain_text, html_text) extracted from a parsed email message."""
    plain = ""
    html = ""

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain" and not plain:
                charset = part.get_content_charset() or "utf-8"
                try:
                    plain = part.get_payload(decode=True).decode(charset, errors="replace")
                except Exception:
                    pass
            elif ct == "text/html" and not html:
                charset = part.get_content_charset() or "utf-8"
                try:
                    html = part.get_payload(decode=True).decode(charset, errors="replace")
                except Exception:
                    pass
    else:
        ct = msg.get_content_type()
        charset = msg.get_content_charset() or "utf-8"
        payload = msg.get_payload(decode=True) or b""
        text = payload.decode(charset, errors="replace")
        if ct == "text/html":
            html = text
        else:
            plain = text

    return plain, html


class BrieflyMailHandler:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def handle_RCPT(
        self,
        server: SMTPServer,
        session: Session,
        envelope: Envelope,
        address: str,
        rcpt_options: list[str],
    ) -> str:
        token = _extract_token(address, self._settings.email_ingestion_domain)
        if token is None:
            log.debug("SMTP: rejecting address %s (not our domain)", address)
            return "550 User not found"
        envelope.rcpt_tos.append(address)
        return "250 OK"

    async def handle_DATA(
        self,
        server: SMTPServer,
        session: Session,
        envelope: Envelope,
    ) -> str:
        try:
            await self._process(envelope)
        except Exception:
            log.exception("SMTP: error processing inbound email")
        return "250 OK"

    async def _process(self, envelope: Envelope) -> None:
        raw_bytes: bytes = envelope.content  # type: ignore[assignment]
        msg = email_lib.message_from_bytes(raw_bytes)

        sender: str = envelope.mail_from or ""
        subject: str = msg.get("Subject") or "(no subject)"

        plain, html = _parse_body(msg)
        body_text = plain or html
        if not body_text.strip():
            log.info("SMTP: empty body from %s — skipping", sender)
            return

        content_hash = hashlib.sha256(body_text.encode()).hexdigest()

        async with SessionLocal() as db:
            for rcpt in envelope.rcpt_tos:
                token = _extract_token(rcpt, self._settings.email_ingestion_domain)
                if not token:
                    continue

                result = await db.execute(
                    select(User).where(User.email_token == token, User.is_active == True)
                )
                user = result.scalar_one_or_none()
                if not user:
                    log.warning("SMTP: no user found for token %s", token)
                    continue

                # Find or create Source record for this sender
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
                    log.info("SMTP: created new email source %s for user %s", sender, user.id)

                # Deduplicate by content hash
                existing_rc = await db.execute(
                    select(RawContent).where(
                        RawContent.source_id == source.id,
                        RawContent.content_hash == content_hash,
                    )
                )
                if existing_rc.scalar_one_or_none():
                    log.debug("SMTP: duplicate content from %s — skipping", sender)
                    continue

                db.add(RawContent(
                    source_id=source.id,
                    user_id=user.id,
                    status=ContentStatus.pending,
                    title=subject,
                    raw_text=body_text[:50_000],
                    content_hash=content_hash,
                    meta={"sender": sender, "subject": subject, "has_html": bool(html)},
                ))

            await db.commit()
            log.info("SMTP: stored email from %s (subject=%r)", sender, subject)


def start_smtp_server(settings: Settings) -> Controller | None:
    """
    Create and start the aiosmtpd Controller.
    Returns the Controller instance so it can be stopped on shutdown.
    """
    handler = BrieflyMailHandler(settings)
    controller = Controller(
        handler,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
    )
    try:
        controller.start()
        log.info(
            "SMTP ingestion server listening on %s:%d",
            settings.smtp_host, settings.smtp_port,
        )
        return controller
    except Exception:
        log.exception("Failed to start SMTP server — newsletter ingestion will be unavailable")
        return None
