"""Send weekly intelligence report emails (Sunday by default)."""
from __future__ import annotations

import asyncio
import logging

import resend
from sqlalchemy import select

from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import User, UserProfile
from briefly_api.services.email_renderer import render_weekly_report_html
from briefly_api.services.weekly_report import generate_weekly_report

log = logging.getLogger(__name__)


async def send_weekly_reports_for_due_users(now_utc) -> int:
    """Send weekly report to users whose local time is Sunday morning."""
    import pytz

    s = get_settings()
    if not s.weekly_report_email_enabled or not s.resend_api_key:
        return 0

    sent = 0
    async with SessionLocal() as session:
        result = await session.execute(
            select(User, UserProfile)
            .join(UserProfile, UserProfile.user_id == User.id)
            .where(UserProfile.onboarding_completed == True, User.is_active == True)
        )
        rows = result.all()

    for user, profile in rows:
        tz_name = profile.digest_timezone or "UTC"
        try:
            tz = pytz.timezone(tz_name)
            local = now_utc.astimezone(tz)
        except Exception:
            continue

        # Sunday 08:00 local — intelligence digest day
        if local.weekday() != 6 or local.strftime("%H:%M") != s.weekly_report_email_time:
            continue

        try:
            async with SessionLocal() as session:
                report = await generate_weekly_report(session, user.id)
                if not report:
                    continue
                html = render_weekly_report_html(report, user.name)
                ok = await _send_report(user.email, report, html)
                if ok:
                    sent += 1
        except Exception:
            log.exception("WeeklyEmail: failed for user %s", user.id)

    if sent:
        log.info("WeeklyEmail: sent %d weekly report(s)", sent)
    return sent


async def _send_report(email: str, report: dict, html: str) -> bool:
    s = get_settings()
    resend.api_key = s.resend_api_key
    week = report.get("week_number", 0)
    subject = f"Your Week {week} with Briefly"
    try:
        await asyncio.wait_for(
            asyncio.to_thread(
                resend.Emails.send,
                {
                    "from": f"{s.digest_from_name} <{s.digest_from_email}>",
                    "to": [email],
                    "subject": subject,
                    "html": html,
                },
            ),
            timeout=20.0,
        )
        return True
    except Exception:
        log.exception("WeeklyEmail: Resend failed for %s", email)
        return False
