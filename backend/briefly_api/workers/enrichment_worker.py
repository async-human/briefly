"""
briefly_api/workers/enrichment_worker.py

ContinuousEnrichmentWorker — the architectural heart of the proactive pipeline.

Runs as a perpetual asyncio task from FastAPI lifespan, sleeping between cycles.
Every `enrichment_worker_interval_hours` (default: 2 hours) it:

  1. ContentWatcherAgent  — detect new items + update source fetch patterns
                            + detect breaking developments
  2. ContextBuilderAgent  — enrich unenriched items: run ConnectionSkill,
                            ContradictionSkill, RelevanceSkill and cache results
  3. BehavioralFingerprint rebuild (if stale > 6 hours)

By 07:00 when the morning pipeline runs, every item in the digest pool already
has its context pre-computed.  The BriefingComposerAgent is just assembly.

Why a single loop instead of separate crons?
  - Avoids thundering herd (all workers waking at :00)
  - Single Redis lock per-user prevents concurrent enrichment
  - Easy to disable globally via enrichment_worker_enabled=false
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import BehavioralFingerprint, UserProfile
from briefly_api.workers.job_queue import job_lock

log = logging.getLogger(__name__)

# Stagger per-user delay to spread load (seconds between users)
_USER_STAGGER_SECONDS = 2


async def continuous_enrichment_loop() -> None:
    """
    Main enrichment loop. Runs forever from FastAPI lifespan.
    Wakes every `enrichment_worker_interval_hours`.
    """
    s = get_settings()
    if not s.enrichment_worker_enabled:
        log.info("EnrichmentWorker: disabled via config — not starting")
        return

    interval = s.enrichment_worker_interval_hours * 3600
    log.info("EnrichmentWorker: started (interval=%dh)", s.enrichment_worker_interval_hours)

    while True:
        try:
            await _run_enrichment_cycle()
        except Exception:
            log.exception("EnrichmentWorker: unhandled error in cycle — will retry next interval")

        await asyncio.sleep(interval)


async def _run_enrichment_cycle() -> None:
    """Run one full enrichment cycle across all active users."""
    s = get_settings()
    log.info("EnrichmentWorker: cycle started at %s UTC", datetime.now(timezone.utc).strftime("%H:%M"))

    # Load all active users with onboarding complete
    async with SessionLocal() as session:
        result = await session.execute(
            select(UserProfile.user_id).where(UserProfile.onboarding_completed == True)
        )
        user_ids = [row[0] for row in result.all()]

    log.info("EnrichmentWorker: processing %d users", len(user_ids))

    for user_id in user_ids:
        await asyncio.sleep(_USER_STAGGER_SECONDS)  # spread load
        try:
            await _enrich_user(user_id, s)
        except Exception:
            log.exception("EnrichmentWorker: failed for user %s — continuing", user_id)


async def _enrich_user(user_id: str, s) -> None:
    """Run full enrichment pipeline for one user under a distributed lock."""
    lock_key = f"briefly:enrichment:{user_id}"

    async with job_lock(lock_key, ttl_seconds=600) as acquired:
        if not acquired:
            log.debug("EnrichmentWorker: lock held for user %s — skipping", user_id)
            return

        async with SessionLocal() as session:
            # ── 1. ContentWatcherAgent ────────────────────────────────────────
            from briefly_api.agents.proactive.content_watcher import run_for_user as watcher_run
            watcher_result = await watcher_run(session, user_id)
            await session.commit()

            # ── 2. ContextBuilderAgent ────────────────────────────────────────
            from briefly_api.agents.proactive.context_builder import run_for_user as builder_run
            builder_result = await builder_run(session, user_id)
            await session.commit()

            # ── 3. Rebuild BehavioralFingerprint if stale ─────────────────────
            fp_result = await session.execute(
                select(BehavioralFingerprint).where(
                    BehavioralFingerprint.user_id == user_id
                )
            )
            fp = fp_result.scalar_one_or_none()
            stale_threshold = timedelta(hours=s.behavioral_fingerprint_refresh_hours)
            needs_rebuild = (
                fp is None
                or (datetime.now(timezone.utc) - (
                    fp.updated_at.replace(tzinfo=timezone.utc)
                    if fp.updated_at.tzinfo is None else fp.updated_at
                )) >= stale_threshold
            )

            if needs_rebuild:
                from briefly_api.services import behavioral_fingerprint as fp_service
                await fp_service.build_and_save(session, user_id)
                await session.commit()

        log.debug(
            "EnrichmentWorker: user=%s watcher=%s builder=%s fingerprint_rebuilt=%s",
            user_id,
            watcher_result.get("new_items", 0),
            builder_result.get("enriched", 0),
            needs_rebuild,
        )


async def run_once_for_user(user_id: str) -> dict:
    """
    Public API — run a single enrichment cycle for one user immediately.
    Used by admin endpoints and tests.
    """
    s = get_settings()
    result: dict = {}

    async with SessionLocal() as session:
        from briefly_api.agents.proactive.content_watcher import run_for_user as watcher_run
        from briefly_api.agents.proactive.context_builder import run_for_user as builder_run
        from briefly_api.services import behavioral_fingerprint as fp_service

        result["content_watcher"] = await watcher_run(session, user_id)
        await session.commit()

        result["context_builder"] = await builder_run(session, user_id)
        await session.commit()

        result["fingerprint"] = bool(await fp_service.build_and_save(session, user_id))
        await session.commit()

    return result
