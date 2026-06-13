"""Transactional emails for Pro subscription lifecycle."""
from __future__ import annotations

import asyncio
import html
import logging

import resend

from briefly_api.config import Settings, get_settings

log = logging.getLogger(__name__)


def _esc(text: str) -> str:
    return html.escape(text, quote=True)


def _wrap(title: str, body_html: str, settings: Settings) -> str:
    dash = settings.frontend_url.rstrip("/") + "/dashboard"
    settings_url = settings.frontend_url.rstrip("/") + "/settings#plan"
    return f"""<!DOCTYPE html><html><body style="font-family:Georgia,'Times New Roman',serif;background:#faf9f6;padding:28px;">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid rgba(28,24,18,0.08);border-radius:12px;padding:28px;">
        <p style="margin:0 0 8px;font-size:11px;color:#9e7b3f;letter-spacing:1px;text-transform:uppercase;font-weight:700;">Briefly</p>
        <h1 style="margin:0 0 16px;font-size:22px;color:#1c1814;font-weight:500;">{_esc(title)}</h1>
        {body_html}
        <p style="margin:24px 0 0;">
          <a href="{dash}" style="display:inline-block;background:#1c1814;color:#faf9f6;padding:11px 20px;border-radius:999px;text-decoration:none;font-size:14px;font-family:sans-serif;">Open dashboard</a>
        </p>
        <p style="margin:16px 0 0;font-size:12px;color:#8c8680;font-family:sans-serif;">
          Manage your plan in <a href="{settings_url}" style="color:#9e7b3f;">Settings</a>.
        </p>
      </div></body></html>"""


async def send_pro_welcome_email(
    email: str,
    name: str | None,
    *,
    is_founding_member: bool = False,
    settings: Settings | None = None,
) -> bool:
    s = settings or get_settings()
    if not s.resend_api_key:
        log.warning("Pro welcome email skipped — RESEND_API_KEY not set")
        return False

    greeting = name or "there"
    tier = "Founding member" if is_founding_member else "Pro"
    body = f"""
        <p style="margin:0 0 16px;font-size:15px;color:#5c5650;line-height:1.65;font-family:sans-serif;">
          Hi {_esc(greeting)}, welcome to Briefly {tier}. Your subscription is active.
        </p>
        <ul style="margin:0 0 8px;padding-left:1.2rem;font-size:14px;color:#5c5650;line-height:1.7;font-family:sans-serif;">
          <li>Unlimited source connections</li>
          <li>Full briefings with brain dump</li>
          <li>Unlimited history &amp; deeper intelligence</li>
        </ul>
        <p style="margin:16px 0 0;font-size:14px;color:#5c5650;line-height:1.6;font-family:sans-serif;">
          Your next briefing will use your full Pro experience automatically.
        </p>"""

    return await _send(
        s,
        to=email,
        subject="Welcome to Briefly Pro",
        html=_wrap("You're on Pro", body, s),
    )


async def send_cancellation_email(
    email: str,
    name: str | None,
    *,
    ends_immediately: bool = False,
    settings: Settings | None = None,
) -> bool:
    s = settings or get_settings()
    if not s.resend_api_key:
        log.warning("Cancellation email skipped — RESEND_API_KEY not set")
        return False

    greeting = name or "there"
    when = (
        "Your Pro access has ended and your account is back on the Free plan."
        if ends_immediately
        else "You'll keep Pro until the end of your current billing period, then return to the Free plan."
    )
    body = f"""
        <p style="margin:0 0 16px;font-size:15px;color:#5c5650;line-height:1.65;font-family:sans-serif;">
          Hi {_esc(greeting)}, we've processed your cancellation request.
        </p>
        <p style="margin:0 0 16px;font-size:15px;color:#5c5650;line-height:1.65;font-family:sans-serif;">
          {when}
        </p>
        <p style="margin:0;font-size:14px;color:#5c5650;line-height:1.6;font-family:sans-serif;">
          You can resubscribe anytime from Settings if you'd like to come back.
        </p>"""

    return await _send(
        s,
        to=email,
        subject="Your Briefly Pro subscription was cancelled",
        html=_wrap("Subscription cancelled", body, s),
    )


async def _send(settings: Settings, *, to: str, subject: str, html: str) -> bool:
    resend.api_key = settings.resend_api_key
    try:
        await asyncio.wait_for(
            asyncio.to_thread(
                resend.Emails.send,
                {
                    "from": f"{settings.digest_from_name} <{settings.digest_from_email}>",
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            ),
            timeout=20.0,
        )
        return True
    except Exception:
        log.exception("Billing email failed for %s", to)
        return False
