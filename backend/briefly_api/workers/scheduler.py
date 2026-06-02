"""
briefly_api/workers/scheduler.py

Nightly scheduler:
  - Ingestion at each user's ingest_time (default 03:00 local) — V1.5
  - Digest at each user's digest_time (default 07:00 local)
  - Footprint scan at 01:00 UTC
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import pytz
from sqlalchemy import select

from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import Digest, UserProfile
from briefly_api.services.briefing import run_briefing_for_scheduled_user
from briefly_api.services.content_ingestion import ingest_user_sources
from briefly_api.services.digest_failure import (
    handle_scheduled_digest_failure,
    process_pending_digest_retries,
)
from briefly_api.workers.footprint_scanner import run_nightly_scan
from briefly_api.workers.job_queue import job_lock
from briefly_api.workers.scheduler_state import (
    has_digest_ran,
    has_ingest_ran,
    mark_digest_ran,
    mark_ingest_ran,
)

log = logging.getLogger(__name__)

_POLL_INTERVAL_SECONDS = 60

_last_footprint_scan_date: str | None = None


async def _profiles_for_scheduling() -> list[UserProfile]:
    async with SessionLocal() as session:
        result = await session.execute(
            select(UserProfile).where(UserProfile.onboarding_completed == True)
        )
        return list(result.scalars().all())


async def _get_due_users(now_utc: datetime) -> list[dict]:
    """Users due for digest at this minute (local digest_time)."""
    profiles = await _profiles_for_scheduling()
    due: list[dict] = []

    async with SessionLocal() as session:
        for profile in profiles:
            tz_name = profile.digest_timezone or "UTC"
            digest_time = profile.digest_time or "07:00"

            try:
                tz = pytz.timezone(tz_name)
                local = now_utc.astimezone(tz)
                local_hhmm = local.strftime("%H:%M")
                local_date = local.strftime("%Y-%m-%d")
            except Exception:
                log.warning("Scheduler: unknown timezone '%s' for user %s", tz_name, profile.user_id)
                continue

            if local_hhmm != digest_time:
                continue

            if await has_digest_ran(profile.user_id, local_date):
                continue

            existing = await session.execute(
                select(Digest).where(
                    Digest.user_id == profile.user_id,
                    Digest.digest_date == local_date,
                )
            )
            if existing.scalar_one_or_none():
                await mark_digest_ran(profile.user_id, local_date)
                continue

            due.append({
                "user_id": profile.user_id,
                "digest_time": digest_time,
                "tz": tz_name,
                "local_date": local_date,
            })

    return due


async def _get_due_ingestion_users(now_utc: datetime) -> list[dict]:
    """Users due for nightly ingestion at ingest_time (once per local calendar day)."""
    settings = get_settings()
    default_ingest = settings.default_ingest_time
    due: list[dict] = []

    profiles = await _profiles_for_scheduling()
    for profile in profiles:
        tz_name = profile.digest_timezone or "UTC"
        ingest_time = profile.ingest_time or default_ingest

        try:
            tz = pytz.timezone(tz_name)
            local = now_utc.astimezone(tz)
            local_hhmm = local.strftime("%H:%M")
            local_date = local.strftime("%Y-%m-%d")
        except Exception:
            continue

        if local_hhmm != ingest_time:
            continue

        if await has_ingest_ran(profile.user_id, local_date):
            continue

        meta = profile.ingestion_meta or {}
        if meta.get("last_run_date") == local_date:
            await mark_ingest_ran(profile.user_id, local_date)
            continue

        due.append({"user_id": profile.user_id, "local_date": local_date})

    return due


async def _run_footprint_scan() -> None:
    try:
        await run_nightly_scan()
    except Exception:
        log.exception("Scheduler: footprint scan failed")


async def _run_ingestion_for_user(user_id: str, local_date: str) -> None:
    lock_key = f"briefly:ingest:{user_id}"
    async with job_lock(lock_key, ttl_seconds=900) as acquired:
        if not acquired:
            log.debug("Scheduler: ingestion lock held for user %s — skipping", user_id)
            return
        try:
            async with SessionLocal() as session:
                summary = await ingest_user_sources(session, user_id)
            await mark_ingest_ran(user_id, local_date)
            log.info(
                "Scheduler: ingested for user %s (new=%d updated=%d)",
                user_id, summary.items_new, summary.items_updated,
            )
        except Exception:
            log.exception("Scheduler: ingestion failed for user %s", user_id)


async def _run_pipeline_for_user(user_id: str, local_date: str) -> None:
    lock_key = f"briefly:digest:{user_id}"
    async with job_lock(lock_key, ttl_seconds=900) as acquired:
        if not acquired:
            log.debug("Scheduler: digest lock held for user %s — skipping", user_id)
            return
        try:
            result = await run_briefing_for_scheduled_user(user_id)
            if result.get("skipped"):
                await mark_digest_ran(user_id, local_date)
                log.debug("Scheduler: digest already exists for user %s — skipped", user_id)
            elif result.get("success"):
                await mark_digest_ran(user_id, local_date)
                log.info(
                    "Scheduler: digest sent for user %s (%d items)",
                    user_id, result.get("total_shown", 0),
                )
            else:
                error = result.get("error") or "Unknown error"
                log.warning("Scheduler: briefing failed for user %s: %s", user_id, error)
                await handle_scheduled_digest_failure(user_id, error)
        except Exception as exc:
            log.exception("Scheduler: unhandled error for user %s", user_id)
            await handle_scheduled_digest_failure(user_id, str(exc))


async def digest_scheduler_loop() -> None:
    """Main scheduler loop — runs forever from FastAPI lifespan."""
    log.info("Digest + ingestion scheduler started (polling every %ds)", _POLL_INTERVAL_SECONDS)
    global _last_footprint_scan_date

    while True:
        try:
            now_utc = datetime.now(timezone.utc)
            today = now_utc.strftime("%Y-%m-%d")

            await process_pending_digest_retries(now_utc)

            due_ingest = await _get_due_ingestion_users(now_utc)
            if due_ingest:
                log.info("Scheduler: %d user(s) due for ingestion", len(due_ingest))
                await asyncio.gather(
                    *[
                        _run_ingestion_for_user(entry["user_id"], entry["local_date"])
                        for entry in due_ingest
                    ],
                    return_exceptions=True,
                )

            due_users = await _get_due_users(now_utc)
            if due_users:
                log.info(
                    "Scheduler: %d user(s) due for digest at %s UTC",
                    len(due_users), now_utc.strftime("%H:%M"),
                )
                await asyncio.gather(
                    *[
                        _run_pipeline_for_user(u["user_id"], u["local_date"])
                        for u in due_users
                    ],
                    return_exceptions=True,
                )

            if _last_footprint_scan_date != today and now_utc.hour == 1 and now_utc.minute == 0:
                _last_footprint_scan_date = today
                asyncio.create_task(_run_footprint_scan())
                log.info("Scheduler: footprint scan task scheduled for %s", today)

        except Exception:
            log.exception("Scheduler: error in poll loop — will retry next cycle")

        await asyncio.sleep(_POLL_INTERVAL_SECONDS)
