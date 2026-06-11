"""Redis-backed per-user API rate limits."""
from __future__ import annotations

import logging

from fastapi import HTTPException, status

from briefly_api.config import get_settings

log = logging.getLogger(__name__)


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
    """
    settings = get_settings()
    if not settings.rate_limit_enabled or limit <= 0:
        return

    redis_url = (settings.redis_url or "").strip()
    if not redis_url:
        if settings.app_env == "production":
            log.warning("Rate limit skipped for %s — REDIS_URL unset", scope)
        return

    key = f"briefly:rl:{scope}:{subject}"

    client = None
    try:
        from redis.asyncio import Redis

        client = Redis.from_url(redis_url, decode_responses=True)
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
        if settings.app_env == "production":
            log.error("Rate limit check failed for %s (%s) — denying request", scope, exc)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Rate limiting temporarily unavailable. Try again shortly.",
            ) from exc
        log.warning("Rate limit check failed for %s (%s) — allowing in non-production", scope, exc)
    finally:
        if client:
            try:
                await client.aclose()
            except Exception:
                pass
