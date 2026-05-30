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
from sqlalchemy.orm import joinedload

from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import Digest, UserProfile
from briefly_api.services.briefing import run_briefing_for_scheduled_user
from briefly_api.workers.footprint_scanner import run_nightly_scan

log = logging.getLogger(__name__)

_POLL_INTERVAL_SECONDS = 60

# Track which calendar day the footprint scan has already run on (UTC date string).
# Reset to None on process restart — that's fine; the scan is idempotent.
_last_footprint_scan_date: str | None = None


async def _get_due_users(now_utc: datetime) -> list[dict]:
    """
    Single DB round-trip: load all onboarded profiles + their today digest
    in one query, then filter by timezone-local digest_time in Python.
    """
    today_utc = now_utc.strftime("%Y-%m-%d")

    async with SessionLocal() as session:
        # LEFT JOIN digests for today so we can skip already-sent users
        # without a second query per user.
        result = await session.execute(
            select(UserProfile, Digest)
            .outerjoin(
                Digest,
                (Digest.user_id == UserProfile.user_id) & (Digest.digest_date == today_utc),
            )
            .where(UserProfile.onboarding_completed == True)
        )
        rows = result.all()

    due = []
    for profile, existing_digest in rows:
        if existing_digest is not None:
            log.debug("Scheduler: digest already exists today for user %s", profile.user_id)
            continue

        tz_name = profile.digest_timezone or "UTC"
        digest_time = profile.digest_time or "07:00"

        try:
            tz = pytz.timezone(tz_name)
            local_hhmm = now_utc.astimezone(tz).strftime("%H:%M")
        except Exception:
            log.warning("Scheduler: unknown timezone '%s' for user %s", tz_name, profile.user_id)
            continue

        if local_hhmm == digest_time:
            due.append({"user_id": profile.user_id, "digest_time": digest_time, "tz": tz_name})

    return due


async def _run_footprint_scan() -> None:
    try:
        await run_nightly_scan()
    except Exception:
        log.exception("Scheduler: footprint scan failed")


async def _run_pipeline_for_user(user_id: str) -> None:
    try:
        result = await run_briefing_for_scheduled_user(user_id)
        if result.get("skipped"):
            log.debug("Scheduler: digest already exists for user %s — skipped", user_id)
        elif result.get("success"):
            log.info(
                "Scheduler: digest sent for user %s (%d items)",
                user_id, result.get("total_shown", 0),
            )
        else:
            log.warning("Scheduler: briefing failed for user %s: %s", user_id, result.get("error"))
    except Exception:
        log.exception("Scheduler: unhandled error for user %s", user_id)


async def digest_scheduler_loop() -> None:
    """
    Main scheduler loop — runs forever, started as a background asyncio task
    from the FastAPI lifespan in main.py.
    """
    log.info("Digest scheduler started (polling every %ds)", _POLL_INTERVAL_SECONDS)
    global _last_footprint_scan_date

    while True:
        try:
            now_utc = datetime.now(timezone.utc)
            today = now_utc.strftime("%Y-%m-%d")

            # ── Nightly digests ───────────────────────────────────────────────
            due_users = await _get_due_users(now_utc)
            if due_users:
                log.info(
                    "Scheduler: %d user(s) due for digest at %s UTC",
                    len(due_users), now_utc.strftime("%H:%M"),
                )
                await asyncio.gather(
                    *[_run_pipeline_for_user(u["user_id"]) for u in due_users],
                    return_exceptions=True,
                )

            # ── Nightly footprint scan (01:00–01:01 UTC, once per day) ────────
            # Runs after most users' digests have fired, uses only Gmail metadata
            # (no email bodies), and is fully idempotent.
            if _last_footprint_scan_date != today and now_utc.hour == 1 and now_utc.minute == 0:
                _last_footprint_scan_date = today
                asyncio.create_task(_run_footprint_scan())
                log.info("Scheduler: footprint scan task scheduled for %s", today)

        except Exception:
            log.exception("Scheduler: error in poll loop — will retry next cycle")

        await asyncio.sleep(_POLL_INTERVAL_SECONDS)
