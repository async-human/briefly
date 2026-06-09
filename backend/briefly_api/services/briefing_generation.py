"""Background briefing generation progress (stored on user_profiles.ingestion_meta)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

log = logging.getLogger(__name__)


async def report_briefing_progress(
    user_id: str,
    *,
    status: str = "running",
    step: str,
    label: str,
    digest_id: str | None = None,
    warnings: list[str] | None = None,
    error: str | None = None,
) -> None:
    """Persist live briefing generation progress for frontend polling."""
    from briefly_api.db.engine import SessionLocal
    from briefly_api.db.models import UserProfile

    async with SessionLocal() as session:
        result = await session.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            return

        meta = dict(profile.ingestion_meta or {})
        prev = meta.get("briefing_generation") or {}

        # Never let a late-arriving per-agent progress write overwrite a terminal
        # state that was already committed by _briefing_worker. Fire-and-forget
        # agent tasks can land after "complete"/"error" is written.
        if prev.get("status") in ("complete", "error") and status == "running":
            return

        now = datetime.now(timezone.utc).isoformat()

        entry: dict = {
            "status": status,
            "step": step,
            "label": label,
            "updated_at": now,
        }
        if prev.get("started_at"):
            entry["started_at"] = prev["started_at"]
        elif status == "running":
            entry["started_at"] = now
        if digest_id:
            entry["digest_id"] = digest_id
        if warnings is not None:
            entry["warnings"] = warnings
        if error:
            entry["error"] = error

        meta["briefing_generation"] = entry
        profile.ingestion_meta = meta
        flag_modified(profile, "ingestion_meta")
        await session.commit()


async def clear_force_refresh_flag(user_id: str) -> None:
    from briefly_api.db.engine import SessionLocal
    from briefly_api.db.models import UserProfile

    async with SessionLocal() as session:
        result = await session.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            return
        meta = dict(profile.ingestion_meta or {})
        gen = dict(meta.get("briefing_generation") or {})
        if not gen.get("force_refresh"):
            return
        gen.pop("force_refresh", None)
        meta["briefing_generation"] = gen
        profile.ingestion_meta = meta
        flag_modified(profile, "ingestion_meta")
        await session.commit()


async def get_briefing_generation_meta(user_id: str) -> dict:
    from briefly_api.db.engine import SessionLocal
    from briefly_api.db.models import UserProfile

    async with SessionLocal() as session:
        result = await session.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        if not profile:
            return {"status": "idle"}
        meta = profile.ingestion_meta or {}
        return dict(meta.get("briefing_generation") or {"status": "idle"})
