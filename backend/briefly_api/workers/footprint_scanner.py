"""
briefly_api/workers/footprint_scanner.py

Nightly Gmail footprint refresh — populates pending source discoveries
for users who haven't confirmed their source list yet.

Sources are NEVER auto-added. Users review candidates on the dashboard
via POST /sources/discover/confirm before their first briefing.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.gmail import get_gmail_connection, refresh_gmail_access_token
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import OAuthConnection, UserProfile

log = logging.getLogger(__name__)


async def scan_for_user(
    user_id: str,
    db: AsyncSession,
    settings: Settings,
) -> dict:
    """Refresh pending discoveries for one user. Returns stats dict."""
    stats: dict[str, int] = {"scanned": 0, "new_sources_added": 0, "errors": 0}

    connection = await get_gmail_connection(db, user_id)
    if not connection:
        return stats

    profile_row = await db.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = profile_row.scalar_one_or_none()
    if not profile or profile.sources_discovery_confirmed_at is not None:
        return stats

    try:
        access_token = await refresh_gmail_access_token(connection, settings)
        await db.commit()
    except Exception as exc:
        log.warning("footprint_scanner: token refresh failed for user %s — %s", user_id, exc)
        stats["errors"] += 1
        return stats

    from briefly_api.services.source_discovery import run_source_discovery

    try:
        result = await run_source_discovery(db, user_id, settings=settings)
        stats["scanned"] = len(result.get("candidates", []))
        log.info(
            "footprint_scanner: refreshed %d pending discoveries for user %s",
            stats["scanned"], user_id,
        )
    except Exception as exc:
        log.warning("footprint_scanner: discovery refresh failed for %s — %s", user_id, exc)
        stats["errors"] += 1

    return stats


async def run_nightly_scan(settings: Settings | None = None) -> None:
    """Scan onboarded Gmail users and refresh pending discoveries."""
    _settings = settings or get_settings()
    log.info("footprint_scanner: starting nightly scan")

    async with SessionLocal() as db:
        result = await db.execute(
            select(UserProfile.user_id)
            .join(
                OAuthConnection,
                (OAuthConnection.user_id == UserProfile.user_id)
                & (OAuthConnection.provider == "gmail"),
            )
            .where(UserProfile.onboarding_completed == True)  # noqa: E712
        )
        user_ids: list[str] = [row[0] for row in result]

    log.info("footprint_scanner: %d users to scan", len(user_ids))

    for user_id in user_ids:
        try:
            async with SessionLocal() as db:
                stats = await scan_for_user(user_id, db, _settings)
                if stats["scanned"] or stats["errors"]:
                    log.info(
                        "footprint_scanner: user %s — candidates=%d errors=%d",
                        user_id, stats["scanned"], stats["errors"],
                    )
        except Exception:
            log.exception("footprint_scanner: unhandled error for user %s", user_id)

    log.info("footprint_scanner: done — scanned %d users", len(user_ids))
