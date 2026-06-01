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
from briefly_api.workers.footprint_scanner import run_nightly_scan
from briefly_api.workers.job_queue import job_lock

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
    today_utc = now_utc.strftime("%Y-%m-%d")

    async with SessionLocal() as session:
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


async def _get_due_ingestion_users(now_utc: datetime) -> list[str]:
    """Users due for nightly ingestion at ingest_time (once per local calendar day)."""
    settings = get_settings()
    default_ingest = settings.default_ingest_time
    due: list[str] = []

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

        meta = profile.ingestion_meta or {}
        if meta.get("last_run_date") == local_date:
            continue

        due.append(profile.user_id)

    return due


async def _run_footprint_scan() -> None:
    try:
        await run_nightly_scan()
    except Exception:
        log.exception("Scheduler: footprint scan failed")


async def _run_ingestion_for_user(user_id: str) -> None:
    lock_key = f"briefly:ingest:{user_id}"
    async with job_lock(lock_key, ttl_seconds=900) as acquired:
        if not acquired:
            log.debug("Scheduler: ingestion lock held for user %s — skipping", user_id)
            return
        try:
            async with SessionLocal() as session:
                summary = await ingest_user_sources(session, user_id)
            log.info(
                "Scheduler: ingested for user %s (new=%d updated=%d)",
                user_id, summary.items_new, summary.items_updated,
            )
        except Exception:
            log.exception("Scheduler: ingestion failed for user %s", user_id)


async def _run_pipeline_for_user(user_id: str) -> None:
    lock_key = f"briefly:digest:{user_id}"
    async with job_lock(lock_key, ttl_seconds=900) as acquired:
        if not acquired:
            log.debug("Scheduler: digest lock held for user %s — skipping", user_id)
            return
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
    """Main scheduler loop — runs forever from FastAPI lifespan."""
    log.info("Digest + ingestion scheduler started (polling every %ds)", _POLL_INTERVAL_SECONDS)
    global _last_footprint_scan_date

    while True:
        try:
            now_utc = datetime.now(timezone.utc)
            today = now_utc.strftime("%Y-%m-%d")

            # ── Nightly ingestion (03:00 user local by default) ───────────────
            due_ingest = await _get_due_ingestion_users(now_utc)
            if due_ingest:
                log.info("Scheduler: %d user(s) due for ingestion", len(due_ingest))
                await asyncio.gather(
                    *[_run_ingestion_for_user(uid) for uid in due_ingest],
                    return_exceptions=True,
                )

            # ── Morning digests ───────────────────────────────────────────────
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

            # ── Nightly footprint scan (01:00 UTC) ────────────────────────────
            if _last_footprint_scan_date != today and now_utc.hour == 1 and now_utc.minute == 0:
                _last_footprint_scan_date = today
                asyncio.create_task(_run_footprint_scan())
                log.info("Scheduler: footprint scan task scheduled for %s", today)

        except Exception:
            log.exception("Scheduler: error in poll loop — will retry next cycle")

        await asyncio.sleep(_POLL_INTERVAL_SECONDS)
