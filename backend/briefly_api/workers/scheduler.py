"""
briefly_api/workers/scheduler.py

Master scheduler — runs as a single asyncio loop from FastAPI lifespan.

Responsibilities:
  - Ingestion at each user's ingest_time (default 03:00 local)        V1.5
  - Digest at each user's digest_time (default 07:00 local)
  - Footprint scan at 01:00 UTC
  - StoryThreadAgent nightly at 02:30 UTC (enhanced thread detection)
  - Weekly intelligence at weekly_intelligence_weekday 02:00 UTC
  (The ContinuousEnrichmentWorker runs as a SEPARATE loop — see
   workers/enrichment_worker.py — because it has a different interval.)
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
_last_story_thread_date: str | None = None
_last_weekly_intelligence_date: str | None = None


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


async def _run_story_thread_agent() -> None:
    """
    Run StoryThreadAgent for every active user.
    Uses a 30-day lookback (vs. 14-day in-pipeline MemoryAgent) and writes
    ProactiveSurfacingEvents for breaking topics and coverage gaps.
    """
    from briefly_api.agents.proactive.story_thread_agent import run_for_user

    s = get_settings()
    if not s.story_thread_agent_enabled:
        return

    async with SessionLocal() as session:
        result = await session.execute(
            select(UserProfile.user_id).where(UserProfile.onboarding_completed == True)
        )
        user_ids = [row[0] for row in result.all()]

    log.info("Scheduler: StoryThreadAgent running for %d users", len(user_ids))
    for user_id in user_ids:
        try:
            lock_key = f"briefly:story_thread:{user_id}"
            async with job_lock(lock_key, ttl_seconds=300) as acquired:
                if not acquired:
                    continue
                async with SessionLocal() as session:
                    summary = await run_for_user(session, user_id)
                    await session.commit()
            log.debug("Scheduler: StoryThreadAgent done for user %s: %s", user_id, summary)
        except Exception:
            log.exception("Scheduler: StoryThreadAgent failed for user %s", user_id)


async def _run_weekly_intelligence() -> None:
    """
    Run WeeklyIntelligenceSkill for every active user and persist results to
    BehavioralFingerprint (current_focus, mind_shifts, emerging_threads).
    """
    from briefly_api.db.models import (
        BehavioralSignal,
        BehavioralFingerprint,
        DigestItem,
        Digest,
        SignalType,
    )
    from briefly_api.agents.skills.weekly_intelligence_skill import WeeklyIntelligenceSkill
    from datetime import timedelta
    from sqlalchemy import select as sa_select, update as sa_update

    s = get_settings()
    if not s.weekly_intelligence_enabled:
        return

    async with SessionLocal() as session:
        result = await session.execute(
            sa_select(UserProfile).where(UserProfile.onboarding_completed == True)
        )
        profiles = result.scalars().all()

    log.info("Scheduler: WeeklyIntelligenceSkill running for %d users", len(profiles))
    skill = WeeklyIntelligenceSkill()
    cutoff_7d = datetime.now(timezone.utc) - timedelta(days=7)

    for profile in profiles:
        user_id = profile.user_id
        try:
            async with SessionLocal() as session:
                # Load last 7 days of digest items with engagement
                items_result = await session.execute(
                    sa_select(
                        DigestItem.headline,
                        DigestItem.was_clicked,
                        DigestItem.follow_up_depth,
                        Digest.digest_date,
                    )
                    .join(Digest, DigestItem.digest_id == Digest.id)
                    .where(
                        Digest.user_id == user_id,
                        Digest.created_at >= cutoff_7d,
                    )
                    .limit(100)
                )
                week_items = [
                    {
                        "date": row.digest_date,
                        "headline": row.headline,
                        "was_clicked": row.was_clicked,
                        "follow_up_depth": row.follow_up_depth or 0,
                    }
                    for row in items_result.all()
                ]

                # Build topic-level signal summary
                sig_result = await session.execute(
                    sa_select(BehavioralSignal.signal_type)
                    .where(
                        BehavioralSignal.user_id == user_id,
                        BehavioralSignal.created_at >= cutoff_7d,
                    )
                    .limit(200)
                )
                sig_types = [row[0] for row in sig_result.all()]
                signal_summary = {
                    "clicked":     sig_types.count(SignalType.clicked),
                    "saved":       sig_types.count(SignalType.saved),
                    "followed_up": sig_types.count(SignalType.followed_up),
                    "skipped":     sig_types.count(SignalType.skipped),
                    "disliked":    sig_types.count(SignalType.disliked),
                    "total":       len(sig_types),
                }

                from briefly_api.agents.briefing_writer import _build_profile_summary
                profile_summary = _build_profile_summary(
                    profile.__dict__,
                    profile.topic_clusters or [],
                )

                declared = [
                    (i.get("topic") or "").strip()
                    for i in (profile.interests or [])
                    if i.get("topic")
                ]
                from briefly_api.db.models import UserMemory
                threads_result = await session.execute(
                    sa_select(UserMemory.key).where(
                        UserMemory.user_id == user_id,
                        UserMemory.memory_type == "story_thread",
                    )
                )
                thread_keys = [row[0] for row in threads_result.all()]

                wi_result = await skill.run(
                    profile_summary=profile_summary,
                    digest_week_items=week_items,
                    signal_summary=signal_summary,
                    declared_interests=declared,
                    story_threads=thread_keys,
                )

                # Persist to BehavioralFingerprint
                fp_result = await session.execute(
                    sa_select(BehavioralFingerprint).where(
                        BehavioralFingerprint.user_id == user_id
                    )
                )
                fp = fp_result.scalar_one_or_none()
                if fp:
                    fp.mind_shifts      = wi_result.mind_shifts
                    fp.coverage_gaps    = wi_result.coverage_gaps
                    fp.current_focus    = wi_result.current_focus
                    await session.flush()
                else:
                    fp = BehavioralFingerprint(
                        user_id=user_id,
                        mind_shifts=wi_result.mind_shifts,
                        coverage_gaps=wi_result.coverage_gaps,
                        current_focus=wi_result.current_focus,
                    )
                    session.add(fp)

                await session.commit()

            log.debug("Scheduler: WeeklyIntelligence done for user %s", user_id)
        except Exception:
            log.exception("Scheduler: WeeklyIntelligence failed for user %s", user_id)


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
            try:
                from briefly_api.services.intelligent_content_discovery import discover_and_cache_for_user
                async with SessionLocal() as disc_session:
                    count = await discover_and_cache_for_user(disc_session, user_id)
                log.info("Scheduler: content discovery for user %s surfaced %d articles", user_id, count)
            except Exception:
                log.exception("Scheduler: content discovery failed for user %s", user_id)
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
    """
    Master scheduler loop — runs forever from FastAPI lifespan.
    Polls every 60 seconds and dispatches jobs at the right UTC hours.

    Schedule:
      01:00 UTC   footprint scan (existing)
      02:00 UTC   weekly intelligence (Monday only, configurable)
      02:30 UTC   StoryThreadAgent (nightly)
      03:00+ local ingestion per user
      07:00+ local digest per user
    """
    log.info("Digest + ingestion scheduler started (polling every %ds)", _POLL_INTERVAL_SECONDS)
    global _last_footprint_scan_date, _last_story_thread_date, _last_weekly_intelligence_date

    s = get_settings()

    while True:
        try:
            now_utc = datetime.now(timezone.utc)
            today   = now_utc.strftime("%Y-%m-%d")

            await process_pending_digest_retries(now_utc)

            # ── Per-user ingestion ────────────────────────────────────────────
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

            # ── Per-user digest ───────────────────────────────────────────────
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

            # ── Nightly footprint scan at 01:00 UTC ───────────────────────────
            if _last_footprint_scan_date != today and now_utc.hour == 1 and now_utc.minute == 0:
                _last_footprint_scan_date = today
                asyncio.create_task(_run_footprint_scan())
                log.info("Scheduler: footprint scan task scheduled for %s", today)

            # ── Weekly intelligence at configured weekday + 02:00 UTC ─────────
            if (
                s.weekly_intelligence_enabled
                and _last_weekly_intelligence_date != today
                and now_utc.weekday() == s.weekly_intelligence_weekday
                and now_utc.hour == s.weekly_intelligence_hour
                and now_utc.minute == 0
            ):
                _last_weekly_intelligence_date = today
                asyncio.create_task(_run_weekly_intelligence())
                log.info("Scheduler: WeeklyIntelligenceSkill task scheduled for %s", today)

            # ── Nightly StoryThreadAgent at 02:30 UTC ─────────────────────────
            if (
                s.story_thread_agent_enabled
                and _last_story_thread_date != today
                and now_utc.hour == 2
                and now_utc.minute == 30
            ):
                _last_story_thread_date = today
                asyncio.create_task(_run_story_thread_agent())
                log.info("Scheduler: StoryThreadAgent task scheduled for %s", today)

        except Exception:
            log.exception("Scheduler: error in poll loop — will retry next cycle")

        await asyncio.sleep(_POLL_INTERVAL_SECONDS)
