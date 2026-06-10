"""
briefly_api/ingestion/smtp_server.py

Inbound SMTP server for newsletter ingestion (local dev).

Production uses Resend inbound webhooks — see api/routes/webhooks.py.
"""
from __future__ import annotations

import email as email_lib
import logging

from aiosmtpd.controller import Controller
from aiosmtpd.smtp import SMTP as SMTPServer, Envelope, Session

from briefly_api.config import Settings, get_settings
from briefly_api.ingestion.inbound_email import store_inbound_email

log = logging.getLogger(__name__)


def _parse_body(msg: email_lib.message.Message) -> tuple[str, str]:
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
        from briefly_api.ingestion.inbound_email import extract_token_from_address

        token = extract_token_from_address(address, self._settings.email_ingestion_domain)
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

        await store_inbound_email(
            recipient_addresses=list(envelope.rcpt_tos),
            sender=sender,
            subject=subject,
            body_text=body_text,
            ingestion_domain=self._settings.email_ingestion_domain,
            has_html=bool(html),
        )


def start_smtp_server(settings: Settings | None = None) -> Controller | None:
    settings = settings or get_settings()
    if not settings.smtp_ingestion_active:
        log.info("SMTP ingestion disabled (use Resend webhook in production)")
        return None

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
            settings.smtp_host,
            settings.smtp_port,
        )
        return controller
    except Exception:
        log.exception("Failed to start SMTP server — newsletter ingestion will be unavailable")
        return None
