from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.config import Settings
from briefly_api.db.models import Digest, User
from briefly_api.utils.dates import local_date_string

log = logging.getLogger(__name__)


def user_local_date(user: User, now_utc: datetime | None = None) -> str:
    tz_name = "UTC"
    if user.profile and user.profile.digest_timezone:
        tz_name = user.profile.digest_timezone
    return local_date_string(tz_name, now_utc)


async def generate_briefing_now(
    user: User,
    db: AsyncSession,
    settings: Settings,
    *,
    max_items: int = 8,
) -> tuple[Digest, list[str]]:
    """Generate today's briefing via the full personalization pipeline."""
    from briefly_api.agents.pipeline import run_for_user

    _ = settings  # pipeline reads settings via get_settings()
    _ = max_items  # digest size controlled by Settings.digest_max_items

    today = user_local_date(user)
    result = await run_for_user(user.id, run_date=today)

    if not result.get("success"):
        raise ValueError(result.get("error", "Could not generate briefing."))

    digest_id = result.get("digest_id")
    if not digest_id:
        raise ValueError("Briefing pipeline completed without a digest.")

    # Load the digest in a brand-new session. The outer session (db) has been
    # open throughout the 30-180s pipeline run and its connection may be stale.
    # A fresh session is guaranteed to see the just-committed digest.
    from briefly_api.db.engine import get_session_factory
    async with get_session_factory()() as fresh:
        loaded = await fresh.execute(
            select(Digest)
            .options(selectinload(Digest.items))
            .where(Digest.id == digest_id)
        )
        digest = loaded.scalar_one_or_none()
    if not digest:
        raise ValueError("Briefing was generated but could not be loaded.")

    warnings = list(result.get("warnings") or [])
    return digest, warnings


async def run_briefing_for_scheduled_user(user_id: str) -> dict:
    """
    Entrypoint for the nightly scheduler: opens its own DB session,
    checks for an existing digest today, generates + emails if missing.
    """
    from briefly_api.db.engine import get_session_factory

    async with get_session_factory()() as session:
        result = await session.execute(
            select(User)
            .options(selectinload(User.profile))
            .where(User.id == user_id, User.is_active == True)
        )
        user = result.scalar_one_or_none()
        if not user:
            return {"success": False, "error": "User not found"}

        today = user_local_date(user)
        existing = await session.execute(
            select(Digest).where(
                Digest.user_id == user_id,
                Digest.digest_date == today,
            )
        )
        if existing.scalar_one_or_none():
            log.info("Scheduler: digest already exists for user %s on %s — skipping", user_id, today)
            return {"success": True, "skipped": True}

        from briefly_api.config import get_settings
        try:
            digest, warnings = await generate_briefing_now(user, session, get_settings())
            return {
                "success": True,
                "digest_id": digest.id,
                "total_shown": digest.total_items_shown,
                "warnings": warnings,
            }
        except ValueError as exc:
            log.warning("Scheduler: briefing failed for user %s: %s", user_id, exc)
            return {"success": False, "error": str(exc)}
        except Exception:
            log.exception("Scheduler: unhandled error for user %s", user_id)
            return {"success": False, "error": "Unhandled error"}
