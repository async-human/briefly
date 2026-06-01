"""
Optional Redis-backed job lock to prevent duplicate ingestion/generation runs.

Falls back to no-op when Redis is unavailable (single-process scheduler still works).
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from briefly_api.config import get_settings

log = logging.getLogger(__name__)


@asynccontextmanager
async def job_lock(key: str, *, ttl_seconds: int = 900):
    """
    Acquire a short-lived lock for `key`. Yields True if acquired, False if not.
    """
    settings = get_settings()
    redis_url = (settings.redis_url or "").strip()
    if not redis_url:
        yield True
        return

    client = None
    acquired = False
    try:
        from redis.asyncio import Redis

        client = Redis.from_url(redis_url, decode_responses=True)
        acquired = await client.set(key, "1", nx=True, ex=ttl_seconds)
        yield bool(acquired)
    except Exception as exc:
        log.warning("Redis lock unavailable (%s) — proceeding without lock", exc)
        yield True
    finally:
        if client:
            try:
                if acquired:
                    await client.delete(key)
                await client.aclose()
            except Exception:
                pass
