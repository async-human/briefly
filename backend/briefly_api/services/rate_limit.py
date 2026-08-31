"""Redis-backed per-user API rate limits with in-process fallback."""
from __future__ import annotations

import asyncio
import logging
import time

from fastapi import HTTPException, status

from briefly_api.config import get_settings

log = logging.getLogger(__name__)

_FALLBACK_LOCK = asyncio.Lock()
_FALLBACK: dict[str, tuple[int, float]] = {}  # key -> (count, window_start)
_REDIS_WARN_AT: dict[str, float] = {}
_REDIS_WARN_INTERVAL_SEC = 60.0


def reset_fallback_for_tests() -> None:
    _FALLBACK.clear()
    _REDIS_WARN_AT.clear()


def _retry_after(window_start: float, window_seconds: int) -> int:
    elapsed = time.monotonic() - window_start
    return max(int(window_seconds - elapsed), 1)


async def _enforce_local(
    *,
    key: str,
    scope: str,
    limit: int,
    window_seconds: int,
) -> None:
    now = time.monotonic()
    async with _FALLBACK_LOCK:
        count, start = _FALLBACK.get(key, (0, now))
        if now - start >= window_seconds:
            count, start = 0, now
        count += 1
        _FALLBACK[key] = (count, start)
        if count > limit:
            retry_after = _retry_after(start, window_seconds)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for {scope}. Try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )


def _warn_redis_fallback(scope: str, exc: Exception) -> None:
    now = time.monotonic()
    last = _REDIS_WARN_AT.get(scope, 0.0)
    if now - last < _REDIS_WARN_INTERVAL_SEC:
        return
    _REDIS_WARN_AT[scope] = now
    log.error(
        "Rate limit Redis unreachable for %s (%s) — using in-process fallback. "
        "Fix REDIS_URL (Railway Redis private URL) so limits are shared across instances.",
        scope,
        exc,
    )


def _redis_from_url(redis_url: str):
    from redis.asyncio import Redis

    return Redis.from_url(redis_url, decode_responses=True)


async def enforce_rate_limit(
    *,
    scope: str,
    subject: str,
    limit: int,
    window_seconds: int,
) -> None:
    """
    Increment a fixed-window counter for scope+subject.
    Raises HTTP 429 when limit is exceeded.

    Redis is preferred so limits are shared across web instances. If Redis is
    misconfigured or unreachable, fall back to an in-process counter instead of
    503-ing generate/Ask. A stale REDIS_URL (unresolvable hostname) must not
    take the product down.
    """
    settings = get_settings()
    if not settings.rate_limit_enabled or limit <= 0:
        return

    redis_url = (settings.redis_url or "").strip()
    key = f"briefly:rl:{scope}:{subject}"

    if not redis_url:
        if settings.app_env == "production":
            log.warning("Rate limit using in-process fallback for %s — REDIS_URL unset", scope)
        await _enforce_local(key=key, scope=scope, limit=limit, window_seconds=window_seconds)
        return

    client = None
    try:
        client = _redis_from_url(redis_url)
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, window_seconds)

        if count > limit:
            retry_after = max(int(await client.ttl(key) or window_seconds), 1)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for {scope}. Try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )
    except HTTPException:
        raise
    except Exception as exc:
        _warn_redis_fallback(scope, exc)
        await _enforce_local(key=key, scope=scope, limit=limit, window_seconds=window_seconds)
    finally:
        if client:
            try:
                await client.aclose()
            except Exception:
                pass
