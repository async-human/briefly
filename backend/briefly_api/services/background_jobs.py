"""
DB-backed background job queue — survives deploys and supports retries.

Processed by the worker process (see workers/runner.py).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import BackgroundJob

log = logging.getLogger(__name__)

JobHandler = Callable[[dict[str, Any]], Awaitable[None]]

_HANDLERS: dict[str, JobHandler] = {}
_STALE_LOCK_MINUTES = 30


def register_job_handler(job_type: str, handler: JobHandler) -> None:
    _HANDLERS[job_type] = handler


async def enqueue_background_job(
    job_type: str,
    payload: dict[str, Any],
    *,
    idempotency_key: str | None = None,
    run_after: datetime | None = None,
    max_attempts: int = 5,
    session: AsyncSession | None = None,
) -> str | None:
    """Enqueue a job. Returns job id, or None if idempotency_key already exists."""
    when = run_after or datetime.now(timezone.utc)
    job_id = None

    async def _write(db: AsyncSession) -> str | None:
        if idempotency_key:
            stmt = (
                insert(BackgroundJob)
                .values(
                    job_type=job_type,
                    payload=payload,
                    idempotency_key=idempotency_key,
                    run_after=when,
                    max_attempts=max_attempts,
                    status="pending",
                )
                .on_conflict_do_nothing(
                    index_elements=["job_type", "idempotency_key"],
                )
                .returning(BackgroundJob.id)
            )
            result = await db.execute(stmt)
            row = result.scalar_one_or_none()
            if row:
                await db.commit()
                return row
            await db.rollback()
            return None

        job = BackgroundJob(
            job_type=job_type,
            payload=payload,
            run_after=when,
            max_attempts=max_attempts,
            status="pending",
        )
        db.add(job)
        await db.flush()
        await db.commit()
        return job.id

    if session is not None:
        return await _write(session)

    async with SessionLocal() as db:
        job_id = await _write(db)
    if job_id:
        log.debug("Enqueued background job %s type=%s", job_id, job_type)
    return job_id


async def _requeue_stale_jobs(session: AsyncSession) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=_STALE_LOCK_MINUTES)
    await session.execute(
        update(BackgroundJob)
        .where(
            BackgroundJob.status == "running",
            BackgroundJob.locked_at < cutoff,
        )
        .values(status="pending", locked_at=None)
    )


async def _claim_next_job(session: AsyncSession) -> BackgroundJob | None:
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(BackgroundJob)
        .where(
            BackgroundJob.status == "pending",
            BackgroundJob.run_after <= now,
        )
        .order_by(BackgroundJob.run_after, BackgroundJob.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job = result.scalar_one_or_none()
    if not job:
        return None
    job.status = "running"
    job.locked_at = now
    job.attempts += 1
    await session.flush()
    return job


async def process_background_jobs_once() -> int:
    """Claim and run up to one pending job. Returns count processed."""
    async with SessionLocal() as session:
        await _requeue_stale_jobs(session)
        await session.commit()

    async with SessionLocal() as session:
        job = await _claim_next_job(session)
        if not job:
            return 0
        await session.commit()

    ensure_job_handlers()
    handler = _HANDLERS.get(job.job_type)
    if not handler:
        async with SessionLocal() as session:
            row = await session.get(BackgroundJob, job.id)
            if row:
                row.status = "failed"
                row.last_error = f"Unknown job type: {job.job_type}"
            await session.commit()
        return 1

    try:
        await handler(job.payload or {})
        async with SessionLocal() as session:
            row = await session.get(BackgroundJob, job.id)
            if row:
                row.status = "done"
                row.locked_at = None
                row.last_error = None
            await session.commit()
        return 1
    except Exception as exc:
        log.exception("Background job %s (%s) failed", job.id, job.job_type)
        async with SessionLocal() as session:
            row = await session.get(BackgroundJob, job.id)
            if row:
                row.locked_at = None
                row.last_error = str(exc)[:2000]
                if row.attempts >= row.max_attempts:
                    row.status = "failed"
                else:
                    row.status = "pending"
                    row.run_after = datetime.now(timezone.utc) + timedelta(
                        minutes=min(60, 2 ** row.attempts)
                    )
            await session.commit()
        return 1


_handlers_ready = False


def ensure_job_handlers() -> None:
    global _handlers_ready
    if _handlers_ready:
        return
    from briefly_api.services.background_job_handlers import register_all_job_handlers

    register_all_job_handlers()
    _handlers_ready = True


async def background_job_loop() -> None:
    from briefly_api.config import get_settings

    ensure_job_handlers()
    settings = get_settings()
    log.info("Background job processor started (poll=%ds)", settings.background_job_poll_seconds)
    while True:
        try:
            processed = await process_background_jobs_once()
            if processed == 0:
                import asyncio

                await asyncio.sleep(settings.background_job_poll_seconds)
        except Exception:
            log.exception("Background job loop error — retrying")
            import asyncio

            await asyncio.sleep(settings.background_job_poll_seconds)

