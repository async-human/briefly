"""Source discovery API — run, review, confirm before first briefing."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.api.schemas import (
    DiscoveredArticleOut,
    DiscoveredArticlesOut,
    DiscoveryCandidateOut,
    DiscoveryConfirmIn,
    DiscoveryConfirmOut,
    DiscoveryRunOut,
    SourceOut,
)
from briefly_api.auth.deps import get_current_user
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import SessionLocal, get_db
from briefly_api.db.models import Source, User, UserProfile
from briefly_api.services.connectors.types import FETCHABLE_SOURCE_TYPES
from briefly_api.services.source_discovery import (
    confirm_discoveries,
    report_discovery_progress,
    run_source_discovery,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["discovery"])


async def _discovery_status(user: User, db: AsyncSession) -> dict:
    profile = user.profile
    if not profile:
        return {
            "confirmed": False,
            "pending_count": 0,
            "candidates": [],
            "meta": {},
        }
    pending = list(profile.pending_source_discoveries or [])
    return {
        "confirmed": profile.sources_discovery_confirmed_at is not None,
        "confirmed_at": profile.sources_discovery_confirmed_at,
        "pending_count": len(pending),
        "candidates": pending,
        "meta": profile.discovery_meta or {},
        "last_run_at": profile.discovery_last_run_at,
    }


async def _discovery_worker(user_id: str) -> None:
    async with SessionLocal() as session:
        try:
            await run_source_discovery(session, user_id, settings=get_settings())
        except Exception:
            log.exception("Discovery worker failed for user %s", user_id)
            await report_discovery_progress(
                user_id,
                status="error",
                step="error",
                label="Discovery failed. Please try again.",
            )


@router.get("/sources/discover/status")
async def get_discovery_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(User).options(selectinload(User.profile)).where(User.id == user.id)
    )
    u = result.scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return await _discovery_status(u, db)


@router.post("/sources/discover/reset")
async def reset_discovery(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Allow re-running the source discovery wizard (clears confirmation gate)."""
    prof = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
    profile = prof.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    profile.sources_discovery_confirmed_at = None
    profile.pending_source_discoveries = []
    meta = dict(profile.discovery_meta or {})
    meta.pop("progress", None)
    profile.discovery_meta = meta
    await db.commit()
    return {"reset": True}


@router.post("/sources/discover/run", response_model=DiscoveryRunOut)
async def run_discovery(
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DiscoveryRunOut:
    prof = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
    profile = prof.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    progress = (profile.discovery_meta or {}).get("progress") or {}
    if progress.get("status") == "running":
        return DiscoveryRunOut(
            status="running",
            candidates=[],
            connected_accounts=(profile.discovery_meta or {}).get("connected_accounts", []),
            meta=profile.discovery_meta or {},
        )

    profile.pending_source_discoveries = []
    now = datetime.now(timezone.utc).isoformat()
    profile.discovery_meta = {
        **(profile.discovery_meta or {}),
        "progress": {
            "status": "running",
            "step": "start",
            "label": "Starting discovery…",
            "updated_at": now,
        },
    }
    await db.commit()

    background_tasks.add_task(_discovery_worker, user.id)

    await db.refresh(profile)
    return DiscoveryRunOut(
        status="running",
        candidates=[],
        connected_accounts=[],
        meta=profile.discovery_meta or {},
    )


@router.post("/sources/discover/confirm", response_model=DiscoveryConfirmOut)
async def confirm_discovery(
    body: DiscoveryConfirmIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> DiscoveryConfirmOut:
    # Allow confirm with zero candidates if user already has sources (skip discovery)
    existing = await db.execute(select(Source).where(Source.user_id == user.id))
    existing_sources = list(existing.scalars().all())
    fetchable = [s for s in existing_sources if s.source_type in FETCHABLE_SOURCE_TYPES]

    if not body.candidate_ids and not fetchable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one source or add a feed manually before continuing.",
        )

    added_sources = []
    if body.candidate_ids:
        result = await confirm_discoveries(db, user.id, body.candidate_ids, settings=settings)
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error"))
        added_sources = result.get("added", [])
    else:
        # Mark confirmed without adding discovery candidates
        prof = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
        profile = prof.scalar_one_or_none()
        if profile:
            profile.sources_discovery_confirmed_at = datetime.now(timezone.utc)
            profile.pending_source_discoveries = []
            await db.commit()

    # Reload all sources after confirm
    all_src = await db.execute(select(Source).where(Source.user_id == user.id))
    sources = list(all_src.scalars().all())

    return DiscoveryConfirmOut(
        added=[SourceOut.model_validate(s) for s in added_sources],
        total_sources=len(sources),
        confirmed=True,
    )


def _articles_out(profile: UserProfile) -> DiscoveredArticlesOut:
    from briefly_api.services.intelligent_content_discovery import get_cached_discoveries

    articles = get_cached_discoveries(profile)
    discovery_meta = profile.discovery_meta or {}
    progress = discovery_meta.get("content_discovery") or {}
    last_run = discovery_meta.get("last_content_discovery") or {}
    meta = {
        **last_run,
        "status": progress.get("status", "idle"),
        "label": progress.get("label", ""),
        "error": progress.get("error"),
    }
    return DiscoveredArticlesOut(
        articles=[DiscoveredArticleOut.model_validate(a) for a in articles],
        refreshed_at=(
            profile.discovered_articles_at.isoformat()
            if profile.discovered_articles_at else None
        ),
        meta=meta,
    )


async def _start_content_discovery(user_id: str, *, force: bool = False) -> None:
    """Mark job running in DB, then run harvest/score in a background task."""
    from briefly_api.services.intelligent_content_discovery import run_content_discovery_job

    async with SessionLocal() as session:
        prof = await session.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        profile = prof.scalar_one_or_none()
        if not profile:
            return

        progress = (profile.discovery_meta or {}).get("content_discovery") or {}
        if progress.get("status") == "running":
            return

        meta = dict(profile.discovery_meta or {})
        meta["content_discovery"] = {
            "status": "running",
            "label": "Refreshing discoveries…" if force else "Starting discovery…",
            "error": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        profile.discovery_meta = meta
        await session.commit()

    asyncio.create_task(run_content_discovery_job(user_id, force_refresh=force))


@router.get("/discover/articles", response_model=DiscoveredArticlesOut)
async def get_discovered_articles(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DiscoveredArticlesOut:
    """Return cached discoveries. Starts a background scan if cache is empty."""
    from briefly_api.services.intelligent_content_discovery import get_cached_discoveries

    prof = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
    profile = prof.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    articles = get_cached_discoveries(profile)
    progress = (profile.discovery_meta or {}).get("content_discovery") or {}

    if not articles and progress.get("status") != "running":
        await _start_content_discovery(user.id, force=False)
        await db.refresh(profile)

    return _articles_out(profile)


@router.post("/discover/articles/refresh", response_model=DiscoveredArticlesOut)
async def refresh_discovered_articles(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DiscoveredArticlesOut:
    """Queue a background refresh — returns immediately with status=running."""
    prof = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
    profile = prof.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    progress = (profile.discovery_meta or {}).get("content_discovery") or {}
    if progress.get("status") != "running":
        await _start_content_discovery(user.id, force=True)
        await db.refresh(profile)

    return _articles_out(profile)
