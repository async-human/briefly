"""Redis-backed scheduler idempotency — survives process restarts."""
from __future__ import annotations

import logging

from briefly_api.config import get_settings

log = logging.getLogger(__name__)

_DIGEST_RAN_TTL_SECONDS = 25 * 3600  # 25 hours
_INGEST_RAN_TTL_SECONDS = 25 * 3600


def _digest_ran_key(user_id: str, local_date: str) -> str:
    return f"briefly:digest_ran:{user_id}:{local_date}"


def _ingest_ran_key(user_id: str, local_date: str) -> str:
    return f"briefly:ingest_ran:{user_id}:{local_date}"


async def _redis_client():
    settings = get_settings()
    redis_url = (settings.redis_url or "").strip()
    if not redis_url:
        return None
    try:
        from redis.asyncio import Redis

        return Redis.from_url(redis_url, decode_responses=True)
    except Exception as exc:
        log.warning("Scheduler state Redis unavailable: %s", exc)
        return None


async def has_digest_ran(user_id: str, local_date: str) -> bool:
    client = await _redis_client()
    if not client:
        return False
    try:
        return bool(await client.get(_digest_ran_key(user_id, local_date)))
    except Exception as exc:
        log.warning("digest_ran check failed: %s", exc)
        return False
    finally:
        await client.aclose()


async def mark_digest_ran(user_id: str, local_date: str) -> None:
    client = await _redis_client()
    if not client:
        return
    try:
        await client.set(_digest_ran_key(user_id, local_date), "1", ex=_DIGEST_RAN_TTL_SECONDS)
    except Exception as exc:
        log.warning("digest_ran mark failed: %s", exc)
    finally:
        await client.aclose()


async def has_ingest_ran(user_id: str, local_date: str) -> bool:
    client = await _redis_client()
    if not client:
        return False
    try:
        return bool(await client.get(_ingest_ran_key(user_id, local_date)))
    except Exception as exc:
        log.warning("ingest_ran check failed: %s", exc)
        return False
    finally:
        await client.aclose()


async def mark_ingest_ran(user_id: str, local_date: str) -> None:
    client = await _redis_client()
    if not client:
        return
    try:
        await client.set(_ingest_ran_key(user_id, local_date), "1", ex=_INGEST_RAN_TTL_SECONDS)
    except Exception as exc:
        log.warning("ingest_ran mark failed: %s", exc)
    finally:
        await client.aclose()
