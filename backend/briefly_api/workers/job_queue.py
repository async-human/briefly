"""
Redis-backed job lock to prevent duplicate ingestion/generation runs.

In production worker mode, locks are fail-closed when Redis is unavailable.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from briefly_api.config import get_settings

log = logging.getLogger(__name__)


def _lock_is_strict(*, strict: bool | None) -> bool:
    settings = get_settings()
    if strict is not None:
        return strict
    return settings.scheduler_lock_strict


@asynccontextmanager
async def job_lock(key: str, *, ttl_seconds: int = 900, strict: bool | None = None):
    """
    Acquire a short-lived lock for `key`. Yields True if acquired, False if not.

    When strict (production worker by default), missing Redis or lock contention
    yields False — the caller must skip the job.
    """
    settings = get_settings()
    redis_url = (settings.redis_url or "").strip()
    must_lock = _lock_is_strict(strict=strict)

    if not redis_url:
        if must_lock:
            log.error("Redis lock required but REDIS_URL is unset — skipping job %s", key)
            yield False
            return
        yield True
        return

    client = None
    acquired = False
    try:
        from redis.asyncio import Redis

        client = Redis.from_url(redis_url, decode_responses=True)
        acquired = await client.set(key, "1", nx=True, ex=ttl_seconds)
    except Exception as exc:
        if must_lock:
            log.error("Redis lock failed for %s (%s) — skipping job", key, exc)
            yield False
            return
        log.warning("Redis lock unavailable (%s) — proceeding without lock", exc)
        yield True
        return

    try:
        yield bool(acquired)
    finally:
        if client:
            try:
                if acquired:
                    await client.delete(key)
                await client.aclose()
            except Exception:
                pass
