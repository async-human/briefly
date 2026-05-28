"""
briefly_api/workers/scheduler.py

Nightly digest scheduler.

Wakes up every minute, finds all users whose digest_time matches the current
minute in their configured timezone, and fires the pipeline for each.

One digest per user per day — if a digest already exists for today it is
skipped, so the scheduler is safe to restart without double-sending.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import pytz
from sqlalchemy import select

from briefly_api.agents.pipeline import run_for_user
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import Digest, UserProfile

log = logging.getLogger(__name__)

_POLL_INTERVAL_SECONDS = 60   # check every minute


async def _get_due_users(now_utc: datetime) -> list[dict]:
    """
    Return users whose digest_time matches the current HH:MM in their timezone
    and who haven't already received a digest today.
    """
    async with SessionLocal() as session:
        result = await session.execute(
            select(UserProfile).where(UserProfile.onboarding_completed == True)
        )
        profiles = result.scalars().all()

    due = []
    today_utc = now_utc.strftime("%Y-%m-%d")

    for profile in profiles:
        tz_name = profile.digest_timezone or "UTC"
        digest_time = profile.digest_time or "07:00"

        try:
            tz = pytz.timezone(tz_name)
            local_now = now_utc.astimezone(tz)
            local_hhmm = local_now.strftime("%H:%M")
        except Exception:
            log.warning("Scheduler: unknown timezone '%s' for user %s", tz_name, profile.user_id)
            continue

        if local_hhmm != digest_time:
            continue

        # Check if a digest already exists for today
        async with SessionLocal() as session:
            result = await session.execute(
                select(Digest).where(
                    Digest.user_id == profile.user_id,
                    Digest.digest_date == today_utc,
                )
            )
            existing = result.scalar_one_or_none()

        if existing:
            log.debug("Scheduler: digest already sent today for user %s", profile.user_id)
            continue

        due.append({"user_id": profile.user_id, "digest_time": digest_time, "tz": tz_name})

    return due


async def _run_pipeline_for_user(user_id: str) -> None:
    try:
        result = await run_for_user(user_id)
        if result.get("success"):
            log.info(
                "Scheduler: digest sent for user %s (%d items, %dms)",
                user_id, result.get("total_shown", 0), result.get("duration_ms", 0),
            )
        else:
            log.warning("Scheduler: pipeline failed for user %s: %s", user_id, result.get("error"))
    except Exception:
        log.exception("Scheduler: unhandled error for user %s", user_id)


async def digest_scheduler_loop() -> None:
    """
    Main scheduler loop — runs forever, called as a background task from
    the FastAPI lifespan.
    """
    log.info("Digest scheduler started (polling every %ds)", _POLL_INTERVAL_SECONDS)

    while True:
        try:
            now_utc = datetime.now(timezone.utc)
            due_users = await _get_due_users(now_utc)

            if due_users:
                log.info("Scheduler: %d user(s) due for digest at %s UTC", len(due_users), now_utc.strftime("%H:%M"))
                # Run pipelines concurrently (each user is independent)
                await asyncio.gather(
                    *[_run_pipeline_for_user(u["user_id"]) for u in due_users],
                    return_exceptions=True,
                )

        except Exception:
            log.exception("Scheduler: error in poll loop — will retry next cycle")

        await asyncio.sleep(_POLL_INTERVAL_SECONDS)
