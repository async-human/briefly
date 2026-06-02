"""Record, notify, and retry failed scheduled digests."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import resend
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import DigestFailure, User
from briefly_api.services.briefing import generate_briefing_now, user_local_date
from briefly_api.workers.job_queue import job_lock
from briefly_api.workers.scheduler_state import mark_digest_ran

log = logging.getLogger(__name__)

RETRY_DELAY_SECONDS = 30 * 60


async def record_digest_failure(
    session: AsyncSession,
    user_id: str,
    digest_date: str,
    error: str,
) -> DigestFailure:
    existing = await session.execute(
        select(DigestFailure).where(
            DigestFailure.user_id == user_id,
            DigestFailure.digest_date == digest_date,
            DigestFailure.resolved_at.is_(None),
        )
    )
    row = existing.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row:
        row.error_message = error[:2000]
        row.updated_at = now
        if row.next_retry_at is None and row.retry_count < row.max_retries:
            row.next_retry_at = now + timedelta(seconds=RETRY_DELAY_SECONDS)
        return row

    failure = DigestFailure(
        user_id=user_id,
        digest_date=digest_date,
        error_message=error[:2000],
        next_retry_at=now + timedelta(seconds=RETRY_DELAY_SECONDS),
    )
    session.add(failure)
    await session.flush()
    return failure


async def notify_digest_failure(user: User, digest_date: str) -> None:
    settings = get_settings()
    if not settings.resend_api_key:
        log.warning("Cannot notify digest failure — RESEND_API_KEY not set")
        return

    resend.api_key = settings.resend_api_key
    html = (
        "<p>We had trouble generating your briefing today. "
        "We'll try again in about 30 minutes.</p>"
        "<p>If you still don't see it, open Briefly and tap <strong>Refresh brief</strong>.</p>"
    )
    try:
        await asyncio.to_thread(
            resend.Emails.send,
            {
                "from": f"{settings.digest_from_name} <{settings.digest_from_email}>",
                "to": [user.email],
                "subject": f"Briefly — briefing delayed ({digest_date})",
                "html": html,
            },
        )
    except Exception:
        log.exception("Failed to send digest failure notification to %s", user.email)


async def handle_scheduled_digest_failure(user_id: str, error: str) -> None:
    async with SessionLocal() as session:
        result = await session.execute(
            select(User)
            .options(selectinload(User.profile))
            .where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            return

        digest_date = user_local_date(user)
        failure = await record_digest_failure(session, user_id, digest_date, error)
        if failure.notified_at is None:
            await notify_digest_failure(user, digest_date)
            failure.notified_at = datetime.now(timezone.utc)
        await session.commit()


async def retry_failed_digest(failure_id: str) -> None:
    lock_key = f"briefly:digest-retry:{failure_id}"
    async with job_lock(lock_key, ttl_seconds=900) as acquired:
        if not acquired:
            return

        async with SessionLocal() as session:
            result = await session.execute(
                select(DigestFailure).where(DigestFailure.id == failure_id)
            )
            failure = result.scalar_one_or_none()
            if not failure or failure.resolved_at:
                return
            if failure.retry_count >= failure.max_retries:
                return

            user_result = await session.execute(
                select(User)
                .options(selectinload(User.profile))
                .where(User.id == failure.user_id, User.is_active == True)
            )
            user = user_result.scalar_one_or_none()
            if not user:
                failure.resolved_at = datetime.now(timezone.utc)
                await session.commit()
                return

            failure.next_retry_at = None
            await session.flush()

            settings = get_settings()
            try:
                digest, _warnings = await generate_briefing_now(user, session, settings)
                failure.resolved_at = datetime.now(timezone.utc)
                await session.commit()
                await mark_digest_ran(user.id, failure.digest_date)
                log.info(
                    "Digest retry succeeded for user %s (%d items)",
                    user.id, digest.total_items_shown,
                )
            except Exception as exc:
                failure.retry_count += 1
                failure.error_message = str(exc)[:2000]
                failure.next_retry_at = None
                await session.commit()
                log.warning("Digest retry failed for user %s: %s", user.id, exc)


async def process_pending_digest_retries(now_utc: datetime | None = None) -> None:
    now = now_utc or datetime.now(timezone.utc)
    async with SessionLocal() as session:
        result = await session.execute(
            select(DigestFailure.id).where(
                DigestFailure.resolved_at.is_(None),
                DigestFailure.retry_count < DigestFailure.max_retries,
                DigestFailure.next_retry_at.is_not(None),
                DigestFailure.next_retry_at <= now,
            )
        )
        failure_ids = [row[0] for row in result.all()]

    for failure_id in failure_ids:
        asyncio.create_task(retry_failed_digest(failure_id))
