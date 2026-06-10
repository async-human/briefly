from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from urllib.parse import urlparse

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from briefly_api.api.schemas import (
    BulkSourceCreate,
    BulkSourceOut,
    DigestOut,
    DigestSummaryOut,
    FeedbackIn,
    BriefingGenerationStatusOut,
    GenerateDigestOut,
    IngestionSummaryOut,
    GmailDiscoverOut,
    GmailSenderOut,
    AutoSuggestionOut,
    MeOut,
    ProfileOut,
    ReadwiseConnectIn,
    SourceCreate,
    SourceDetectOut,
    SourceOut,
    SourcePriorityIn,
    SourceSuggestionOut,
    UserOut,
)
from briefly_api.auth.gmail import (
    get_gmail_connection,
    refresh_gmail_access_token,
    user_message_for_gmail_error,
)
from briefly_api.auth.youtube import get_youtube_connection
from briefly_api.auth.reddit import get_reddit_connection
from briefly_api.api.plan_limits import FREE_HISTORY_DAYS, check_source_limit
from briefly_api.auth.deps import get_current_user
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import (
    BehavioralSignal, Digest, DigestItem, SignalType, Source, User, UserProfile,
)
from briefly_api.db.engine import SessionLocal
from briefly_api.services.connectors.registry import detect_source, get_connector
from briefly_api.services.connectors.types import ALL_SOURCE_TYPES
from briefly_api.services.url_scraper import discover_rss_feed

log = logging.getLogger(__name__)

# Minimum number of clicks on a domain before auto-subscribing its RSS feed
_CLICK_DISCOVERY_THRESHOLD = 2
# Lookback window for counting clicks (days)
_CLICK_WINDOW_DAYS = 30

router = APIRouter(tags=["dashboard"])


async def _resolve_source(body: SourceCreate, settings: Settings) -> tuple[str, str]:
    identifier = body.identifier.strip()
    if not identifier:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identifier is required.")

    if body.source_type:
        source_type = body.source_type.strip().lower()
        if source_type not in ALL_SOURCE_TYPES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid source type.")
        connector = get_connector(source_type)
        if not connector:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid source type.")
        normalized = connector.normalize_identifier(identifier)
        validation = await connector.validate(normalized, settings)
        if not validation.valid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=validation.message)
        return source_type, normalized

    detected = await detect_source(identifier, settings)
    connector = get_connector(detected.source_type)
    if connector:
        validation = await connector.validate(detected.identifier, settings)
        if not validation.valid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=validation.message)
    return detected.source_type, detected.identifier


async def _compute_streak(user_id: str, db: AsyncSession) -> int:
    """Return the number of consecutive days the user has had a digest."""
    result = await db.execute(
        select(Digest.digest_date)
        .where(Digest.user_id == user_id, Digest.status.in_(["sent", "ready"]))
        .order_by(Digest.digest_date.desc())
        .limit(366)
    )
    dates_str = [row[0] for row in result]
    if not dates_str:
        return 0

    dates = sorted([date.fromisoformat(d) for d in dates_str], reverse=True)
    today = date.today()

    # Only count as active if the most recent digest is today or yesterday
    if dates[0] < today - timedelta(days=1):
        return 0

    streak = 1
    for i in range(1, len(dates)):
        if dates[i] == dates[i - 1] - timedelta(days=1):
            streak += 1
        else:
            break
    return streak


async def _auto_suggestions_for_user(user: User, db: AsyncSession) -> list[AutoSuggestionOut]:
    """Return interest-driven suggestions not already connected as sources."""
    if not user.profile or not user.profile.suggested_sources:
        return []

    result = await db.execute(
        select(Source.identifier).where(Source.user_id == user.id)
    )
    already_added = {row[0].lower() for row in result.all()}

    out: list[AutoSuggestionOut] = []
    for item in user.profile.suggested_sources:
        url = (item.get("url") or "").strip()
        if not url or url.lower() in already_added:
            continue
        out.append(AutoSuggestionOut(
            name=item.get("name") or url,
            url=url,
            source_type=item.get("source_type") or "rss",
            topic=item.get("topic") or "",
            description=item.get("description") or "",
            reason=item.get("reason") or "",
            discovered_at=item.get("discovered_at"),
            source=item.get("source") or "catalog",
        ))
    return out


@router.get("/me", response_model=MeOut)
async def get_me(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db),
) -> MeOut:
    ingestion_email = f"{user.email_token}@{settings.email_ingestion_domain}"
    profile_orm = user.profile
    profile_out = ProfileOut.model_validate(profile_orm) if profile_orm else None
    gmail = await get_gmail_connection(db, user.id)
    youtube = await get_youtube_connection(db, user.id)
    reddit = await get_reddit_connection(db, user.id)
    streak = await _compute_streak(user.id, db)
    auto_suggestions = await _auto_suggestions_for_user(user, db)
    return MeOut(
        user=UserOut.model_validate(user),
        profile=profile_out,
        ingestion_email=ingestion_email,
        onboarding_completed=bool(profile_orm and profile_orm.onboarding_completed),
        gmail_connected=gmail is not None,
        youtube_connected=youtube is not None,
        reddit_connected=reddit is not None,
        reading_streak=streak,
        auto_suggestions=auto_suggestions,
        sources_discovery_confirmed=bool(
            profile_orm and profile_orm.sources_discovery_confirmed_at is not None
        ),
        pending_discovery_count=len(profile_orm.pending_source_discoveries or []) if profile_orm else 0,
    )


@router.get("/digests", response_model=list[DigestSummaryOut])
async def list_digests(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 20,
) -> list[DigestSummaryOut]:
    query = select(Digest).where(Digest.user_id == user.id)
    if user.plan != "pro":
        cutoff = (date.today() - timedelta(days=FREE_HISTORY_DAYS)).isoformat()
        query = query.where(Digest.digest_date >= cutoff)
    result = await db.execute(query.order_by(Digest.digest_date.desc()).limit(limit))
    digests = result.scalars().all()
    return [DigestSummaryOut.model_validate(d) for d in digests]


@router.get("/digests/latest", response_model=DigestOut | None)
async def get_latest_digest(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DigestOut | None:
    result = await db.execute(
        select(Digest)
        .options(selectinload(Digest.items))
        .where(Digest.user_id == user.id)
        .order_by(Digest.digest_date.desc())
        .limit(1)
    )
    digest = result.scalar_one_or_none()
    if not digest:
        return None
    return DigestOut.model_validate(digest)


@router.get("/digests/today", response_model=DigestOut | None)
async def get_today_digest(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DigestOut | None:
    """Return today's digest in the user's digest_timezone, or null if missing."""
    from briefly_api.utils.dates import local_date_string

    profile = user.profile
    tz_name = (profile.digest_timezone if profile else None) or "UTC"
    local_today = local_date_string(tz_name)

    result = await db.execute(
        select(Digest)
        .options(selectinload(Digest.items))
        .where(
            Digest.user_id == user.id,
            Digest.digest_date == local_today,
        )
        .limit(1)
    )
    digest = result.scalar_one_or_none()
    if not digest:
        return None
    item_count = (digest.total_items_shown or 0) or len(digest.items or [])
    if item_count <= 0:
        return None
    return DigestOut.model_validate(digest)


@router.get("/digests/{digest_id}", response_model=DigestOut)
async def get_digest(
    digest_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DigestOut:
    result = await db.execute(
        select(Digest)
        .options(selectinload(Digest.items))
        .where(Digest.id == digest_id, Digest.user_id == user.id)
    )
    digest = result.scalar_one_or_none()
    if not digest:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Digest not found")
    return DigestOut.model_validate(digest)


@router.get("/digests/{digest_id}/feedback")
async def get_digest_feedback(
    digest_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return the user's saved/disliked signals for items in a digest.

    Used by the reading UI to restore star/thumbs-down state when the user
    returns to a brief they've already partially read.
    Returns: {digest_item_id: "saved" | "disliked"}
    When an item has both signals the most recent wins.
    """
    result = await db.execute(
        select(BehavioralSignal.digest_item_id, BehavioralSignal.signal_type)
        .where(
            BehavioralSignal.user_id == user.id,
            BehavioralSignal.digest_id == digest_id,
            BehavioralSignal.signal_type.in_([SignalType.saved, SignalType.disliked]),
        )
        .order_by(BehavioralSignal.created_at.asc())
    )
    signals: dict[str, str] = {}
    for row in result.all():
        if row.digest_item_id:
            signals[row.digest_item_id] = row.signal_type.value
    return signals


@router.get("/sources", response_model=list[SourceOut])
async def list_sources(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SourceOut]:
    result = await db.execute(
        select(Source)
        .where(Source.user_id == user.id)
        .order_by(Source.created_at.desc())
    )
    sources = result.scalars().all()
    return [SourceOut.model_validate(s) for s in sources]


@router.post("/sources/detect", response_model=SourceDetectOut)
async def detect_source_type(
    body: SourceCreate,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SourceDetectOut:
    try:
        if body.source_type:
            connector = get_connector(body.source_type.strip().lower())
            if not connector:
                raise ValueError("Invalid source type.")
            normalized = connector.normalize_identifier(body.identifier)
            return SourceDetectOut(
                source_type=connector.source_type,
                identifier=normalized,
                label=connector.label,
                hint=connector.detect_hint,
                confidence="high",
            )
        detected = await detect_source(body.identifier, settings)
        return SourceDetectOut(
            source_type=detected.source_type,
            identifier=detected.identifier,
            label=detected.label,
            hint=detected.hint,
            confidence=detected.confidence,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/sources", response_model=SourceOut, status_code=status.HTTP_201_CREATED)
async def create_source(
    body: SourceCreate,
    user: User = Depends(check_source_limit),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SourceOut:
    try:
        source_type, identifier = await _resolve_source(body, settings)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    existing = await db.execute(
        select(Source).where(
            Source.user_id == user.id,
            Source.source_type == source_type,
            Source.identifier == identifier,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This source is already connected.",
        )

    source = Source(
        user_id=user.id,
        source_type=source_type,
        identifier=identifier,
        name=body.name.strip() if body.name else None,
    )
    db.add(source)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This source is already connected.",
        ) from exc
    await db.refresh(source)
    return SourceOut.model_validate(source)


@router.patch("/sources/{source_id}/priority", response_model=SourceOut)
async def set_source_priority(
    source_id: str,
    body: SourcePriorityIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SourceOut:
    from briefly_api.services.source_priority import VALID_PRIORITIES, normalize_priority

    priority = normalize_priority(body.priority.strip().lower())
    if priority not in VALID_PRIORITIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Priority must be high, normal, or low.",
        )

    result = await db.execute(
        select(Source).where(Source.id == source_id, Source.user_id == user.id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")

    meta = dict(source.meta or {})
    meta["priority"] = priority
    source.meta = meta
    await db.commit()
    await db.refresh(source)
    return SourceOut.model_validate(source)


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_source(
    source_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    result = await db.execute(
        select(Source).where(Source.id == source_id, Source.user_id == user.id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
    await db.delete(source)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _briefing_worker(user_id: str) -> None:
    from briefly_api.config import get_settings
    from briefly_api.services.briefing import generate_briefing_now
    from briefly_api.services.briefing_generation import report_briefing_progress
    from briefly_api.services.digest_failure import handle_scheduled_digest_failure

    log.info("Briefing worker started for user %s", user_id)
    async with SessionLocal() as session:
        try:
            await report_briefing_progress(
                user_id,
                status="running",
                step="start",
                label="Starting briefing generation…",
            )
            result = await session.execute(
                select(User)
                .options(selectinload(User.profile))
                .where(User.id == user_id)
            )
            user = result.scalar_one_or_none()
            if not user:
                await report_briefing_progress(
                    user_id,
                    status="error",
                    step="error",
                    label="Briefing failed.",
                    error="User not found",
                )
                return

            digest, warnings = await asyncio.wait_for(
                generate_briefing_now(user, session, get_settings()),
                timeout=360.0,
            )
            item_count = (digest.total_items_shown or 0) or len(digest.items or [])
            if item_count <= 0:
                raise ValueError(
                    "No relevant stories found in your sources right now. "
                    "Try refreshing sources, then generate again."
                )
            await report_briefing_progress(
                user_id,
                status="complete",
                step="done",
                label="Briefing ready!",
                digest_id=digest.id,
                warnings=warnings,
            )
            # Clear one-shot refresh flag so the next scheduled run uses the normal pool path.
            from briefly_api.services.briefing_generation import clear_force_refresh_flag
            await clear_force_refresh_flag(user_id)
            log.info(
                "Briefing worker completed for user %s (digest_id=%s items=%s)",
                user_id,
                digest.id,
                digest.total_items_shown,
            )
        except asyncio.TimeoutError:
            log.error("Briefing worker timed out (>4 min) for user %s", user_id)
            msg = "Briefing took too long to generate. Please try again."
            await report_briefing_progress(
                user_id,
                status="error",
                step="error",
                label="Briefing failed.",
                error=msg,
            )
            from briefly_api.services.briefing_generation import clear_force_refresh_flag
            await clear_force_refresh_flag(user_id)
            await handle_scheduled_digest_failure(user_id, msg)
        except ValueError as exc:
            log.warning("Briefing worker failed for user %s: %s", user_id, exc)
            await report_briefing_progress(
                user_id,
                status="error",
                step="error",
                label="Briefing failed.",
                error=str(exc),
            )
            from briefly_api.services.briefing_generation import clear_force_refresh_flag
            await clear_force_refresh_flag(user_id)
            await handle_scheduled_digest_failure(user_id, str(exc))
        except Exception as exc:
            log.exception("Briefing worker failed for user %s", user_id)
            message = str(exc).strip() or "Briefing generation failed. Please try again."
            if len(message) > 300:
                message = message[:297] + "..."
            await report_briefing_progress(
                user_id,
                status="error",
                step="error",
                label="Briefing failed.",
                error=message,
            )
            from briefly_api.services.briefing_generation import clear_force_refresh_flag
            await clear_force_refresh_flag(user_id)
            await handle_scheduled_digest_failure(user_id, message)


@router.get("/digests/generate/status", response_model=BriefingGenerationStatusOut)
async def get_briefing_generation_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BriefingGenerationStatusOut:
    from briefly_api.utils.dates import local_date_string

    profile = user.profile
    if not profile:
        return BriefingGenerationStatusOut(status="idle")

    meta = dict(profile.ingestion_meta or {})
    gen = dict(meta.get("briefing_generation") or {"status": "idle"})

    # Auto-clear zombie "running" left by a crashed worker so clients can restart.
    if gen.get("status") == "running":
        started_raw = gen.get("started_at", "")
        age_minutes = 999.0
        if started_raw:
            try:
                started_dt = datetime.fromisoformat(started_raw.replace("Z", "+00:00"))
                if started_dt.tzinfo is None:
                    started_dt = started_dt.replace(tzinfo=timezone.utc)
                age_minutes = (datetime.now(timezone.utc) - started_dt).total_seconds() / 60
            except Exception:
                age_minutes = 999.0
        if age_minutes > 6:
            local_today = local_date_string(profile.digest_timezone or "UTC")
            today_digest = await db.scalar(
                select(Digest.id).where(
                    Digest.user_id == user.id,
                    Digest.digest_date == local_today,
                )
            )
            if not today_digest:
                now = datetime.now(timezone.utc).isoformat()
                gen = {
                    "status": "error",
                    "step": "error",
                    "label": "Briefing failed.",
                    "error": "Briefing generation timed out. Please refresh to try again.",
                    "started_at": gen.get("started_at"),
                    "updated_at": now,
                }
                meta["briefing_generation"] = gen
                profile.ingestion_meta = meta
                flag_modified(profile, "ingestion_meta")
                await db.commit()

    digest_out: DigestOut | None = None
    digest_id = gen.get("digest_id")
    if gen.get("status") == "complete" and digest_id:
        result = await db.execute(
            select(Digest)
            .options(selectinload(Digest.items))
            .where(Digest.id == digest_id, Digest.user_id == user.id)
        )
        digest = result.scalar_one_or_none()
        if digest:
            item_count = (digest.total_items_shown or 0) or len(digest.items or [])
            if item_count > 0:
                digest_out = DigestOut.model_validate(digest)
            else:
                now = datetime.now(timezone.utc).isoformat()
                gen = {
                    "status": "error",
                    "step": "error",
                    "label": "Briefing failed.",
                    "error": (
                        "Briefing finished but had no items to show. "
                        "Refresh your sources or try again shortly."
                    ),
                    "started_at": gen.get("started_at"),
                    "updated_at": now,
                }
                meta["briefing_generation"] = gen
                profile.ingestion_meta = meta
                flag_modified(profile, "ingestion_meta")
                await db.commit()

    return BriefingGenerationStatusOut(
        status=gen.get("status", "idle"),
        step=gen.get("step"),
        label=gen.get("label"),
        digest_id=digest_id,
        digest=digest_out,
        warnings=list(gen.get("warnings") or []),
        error=gen.get("error"),
        started_at=gen.get("started_at"),
        updated_at=gen.get("updated_at"),
    )


@router.post("/digests/generate", response_model=GenerateDigestOut)
async def generate_digest_now(
    force: bool = False,
    restart: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GenerateDigestOut:
    prof = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
    profile = prof.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    from briefly_api.utils.dates import local_date_string

    local_today = local_date_string(profile.digest_timezone or "UTC")
    existing = await db.execute(
        select(Digest)
        .options(selectinload(Digest.items))
        .where(
            Digest.user_id == user.id,
            Digest.digest_date == local_today,
        )
    )
    digest = existing.scalar_one_or_none()
    item_count = (digest.total_items_shown if digest else 0) or len(digest.items if digest else [])
    if digest and item_count > 0 and not (force or restart):
        return GenerateDigestOut(
            status="complete",
            digest=DigestOut.model_validate(digest),
            warnings=[],
        )

    meta = dict(profile.ingestion_meta or {})
    gen = meta.get("briefing_generation") or {}
    if gen.get("status") == "running":
        # Guard against stale "running" state left by a crashed worker.
        started_raw = gen.get("started_at", "")
        age_minutes = 999.0
        if started_raw:
            try:
                started_dt = datetime.fromisoformat(started_raw.replace("Z", "+00:00"))
                if started_dt.tzinfo is None:
                    started_dt = started_dt.replace(tzinfo=timezone.utc)
                age_minutes = (datetime.now(timezone.utc) - started_dt).total_seconds() / 60
            except Exception:
                age_minutes = 999.0
        is_stale = age_minutes > 15
        # restart=true (Refresh brief) always takes over; auto-generate waits ~3 min.
        can_takeover = restart or is_stale or age_minutes > 3
        if not can_takeover:
            return GenerateDigestOut(status="running", digest=None, warnings=[])
        log.info(
            "Taking over briefing generation for user %s (restart=%s force=%s age=%.1fm)",
            user.id,
            restart,
            force,
            age_minutes,
        )

    from briefly_api.db.models import DigestFailure

    failure = await db.scalar(
        select(DigestFailure).where(
            DigestFailure.user_id == user.id,
            DigestFailure.digest_date == local_today,
            DigestFailure.resolved_at.is_(None),
        )
    )
    if failure:
        failure.retry_count = 0
        failure.next_retry_at = None
        failure.error_message = ""
        failure.updated_at = datetime.now(timezone.utc)

    if force or restart:
        from briefly_api.config import get_settings as _get_settings
        from briefly_api.services.content_ingestion import ingest_user_sources

        try:
            await ingest_user_sources(db, user.id, settings=_get_settings())
        except Exception:
            log.warning("Pre-refresh source ingest failed for user %s", user.id, exc_info=True)

    now = datetime.now(timezone.utc).isoformat()
    meta["briefing_generation"] = {
        "status": "running",
        "step": "start",
        "label": "Fetching fresh content from your sources…" if (force or restart) else "Starting briefing generation…",
        "started_at": now,
        "updated_at": now,
        "force_refresh": bool(force or restart),
    }
    profile.ingestion_meta = meta
    flag_modified(profile, "ingestion_meta")
    await db.commit()

    log.info("Starting briefing worker for user %s (digest_date=%s)", user.id, local_today)
    # create_task starts immediately in the event loop (more reliable than BackgroundTasks on some hosts).
    asyncio.create_task(_briefing_worker(user.id))
    return GenerateDigestOut(status="running", digest=None, warnings=[])


@router.get("/ingestion/summary", response_model=IngestionSummaryOut)
async def get_ingestion_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> IngestionSummaryOut:
    from datetime import datetime, timedelta, timezone

    from briefly_api.db.models import ContentStatus, RawContent
    from briefly_api.services.activity_feed import list_activity

    profile = user.profile
    meta = dict(profile.ingestion_meta or {}) if profile else {}
    last_summary = meta.get("last_summary") or {}
    feed = await list_activity(db, user.id, limit=10) if profile else []

    pool_count = 0
    if profile:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.pool_max_age_hours)
        pool_count = await db.scalar(
            select(func.count())
            .select_from(RawContent)
            .where(
                RawContent.user_id == user.id,
                RawContent.ingested_at >= cutoff,
                RawContent.status.in_([ContentStatus.pending, ContentStatus.processed]),
            )
        ) or 0

    return IngestionSummaryOut(
        last_ingestion_at=profile.last_ingestion_at if profile else None,
        last_summary=last_summary,
        activity_feed=feed,
        pool_items_recent=pool_count,
    )


@router.post("/ingestion/run", response_model=IngestionSummaryOut)
async def run_ingestion_now(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> IngestionSummaryOut:
    from briefly_api.services.activity_feed import list_activity
    from briefly_api.services.content_ingestion import ingest_user_sources

    summary = await ingest_user_sources(db, user.id, settings=settings)
    prof = await db.execute(
        select(UserProfile).where(UserProfile.user_id == user.id)
    )
    profile = prof.scalar_one_or_none()
    return IngestionSummaryOut(
        last_ingestion_at=profile.last_ingestion_at if profile else None,
        last_summary=summary.to_dict(),
        activity_feed=await list_activity(db, user.id, limit=10),
        pool_items_recent=summary.items_new + summary.items_updated,
    )


# ── Gmail newsletter discovery ────────────────────────────────────────────────

@router.get("/sources/discover/gmail", response_model=GmailDiscoverOut)
async def discover_gmail_newsletters(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> GmailDiscoverOut:
    from briefly_api.services.gmail_discovery import discover_newsletter_senders

    connection = await get_gmail_connection(db, user.id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Gmail is not connected.",
        )

    access_token = await refresh_gmail_access_token(connection, settings)
    await db.commit()

    existing = await db.execute(
        select(Source).where(
            Source.user_id == user.id,
            Source.source_type == "email",
        )
    )
    already_added = {s.identifier for s in existing.scalars().all()}

    senders, _, access_error, access_error_message = await discover_newsletter_senders(
        access_token, already_added,
    )
    if access_error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=user_message_for_gmail_error(access_error, access_error_message),
        )
    return GmailDiscoverOut(
        senders=[GmailSenderOut(**s) for s in senders]
    )


# ── Bulk source add ───────────────────────────────────────────────────────────

@router.post("/sources/bulk", response_model=BulkSourceOut, status_code=status.HTTP_201_CREATED)
async def bulk_create_sources(
    body: BulkSourceCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> BulkSourceOut:
    from briefly_api.api.plan_limits import FREE_SOURCE_LIMIT

    added: list[Source] = []
    skipped = 0

    # For free users, cap how many more sources they can add
    remaining_slots: int | None = None
    if user.plan != "pro":
        count_result = await db.execute(
            select(func.count()).select_from(Source).where(Source.user_id == user.id)
        )
        current_count = count_result.scalar() or 0
        remaining_slots = max(0, FREE_SOURCE_LIMIT - current_count)

    for item in body.sources:
        if remaining_slots is not None and remaining_slots <= 0:
            skipped += 1
            continue
        try:
            source_type, identifier = await _resolve_source(item, settings)
        except HTTPException:
            skipped += 1
            continue

        existing = await db.execute(
            select(Source).where(
                Source.user_id == user.id,
                Source.source_type == source_type,
                Source.identifier == identifier,
            )
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue

        source = Source(
            user_id=user.id,
            source_type=source_type,
            identifier=identifier,
            name=item.name.strip() if item.name else None,
        )
        db.add(source)
        added.append(source)
        if remaining_slots is not None:
            remaining_slots -= 1

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        skipped += len(added)
        added = []

    for source in added:
        await db.refresh(source)

    return BulkSourceOut(
        added=[SourceOut.model_validate(s) for s in added],
        skipped=skipped,
    )


# ── Behavioral intelligence helper ───────────────────────────────────────────

def _topic_keywords(topic: str) -> set[str]:
    """Extract match tokens from a declared topic (supports short terms like 'ai')."""
    normalized = topic.strip().lower().replace("-", " ")
    keywords: set[str] = set()
    for word in normalized.split():
        cleaned = word.strip(".,;:!?\"'()[]")
        if len(cleaned) >= 2:
            keywords.add(cleaned)
    return keywords


async def _compute_behavioral_intelligence(
    user_id: str,
    profile,
    db: AsyncSession,
) -> dict:
    """
    Mine BehavioralSignal + DigestItem for real behavioral patterns.
    Returns per-topic actual engagement, emerging topics, source patterns,
    and human-readable insight sentences — all derived from what the user
    actually clicked/saved/skipped, not what they declared.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=45)

    result = await db.execute(
        select(
            BehavioralSignal.signal_type,
            BehavioralSignal.created_at,
            DigestItem.headline,
            DigestItem.source_name,
            DigestItem.why_it_matters,
            DigestItem.summary,
        )
        .join(DigestItem, BehavioralSignal.digest_item_id == DigestItem.id)
        .where(
            BehavioralSignal.user_id == user_id,
            BehavioralSignal.created_at >= cutoff,
            BehavioralSignal.signal_type.in_([
                SignalType.saved, SignalType.clicked, SignalType.followed_up,
                SignalType.skipped, SignalType.disliked,
            ]),
            BehavioralSignal.digest_item_id.isnot(None),
        )
        .limit(600)
    )
    signals = result.all()

    if not signals:
        return {}

    pos_types  = {SignalType.saved, SignalType.clicked, SignalType.followed_up}
    neg_types  = {SignalType.skipped, SignalType.disliked}

    total      = len(signals)
    save_count = sum(1 for s in signals if s.signal_type == SignalType.saved)
    pos_count  = sum(1 for s in signals if s.signal_type in pos_types)

    overall_engagement = round(pos_count / max(total, 1), 3)
    save_rate          = round(save_count / max(total, 1), 3)

    # Per-source engagement (min 3 signals to count)
    src_pos: dict[str, int] = {}
    src_tot: dict[str, int] = {}
    for s in signals:
        if not s.source_name:
            continue
        k = s.source_name.lower().strip()
        src_tot[k] = src_tot.get(k, 0) + 1
        if s.signal_type in pos_types:
            src_pos[k] = src_pos.get(k, 0) + 1

    source_engagement = {
        k: round(src_pos.get(k, 0) / v, 3)
        for k, v in src_tot.items()
        if v >= 3
    }

    # Per-declared-topic actual engagement via keyword / phrase matching
    declared_topics = [
        (i.get("topic") or "").strip().lower()
        for i in (profile.interests or [])
        if i.get("topic")
    ]
    declared_word_set: set[str] = set()
    for t in declared_topics:
        declared_word_set.update(_topic_keywords(t))

    def _item_text(s) -> str:
        return " ".join(
            filter(None, [s.headline, s.summary, s.why_it_matters, s.source_name])
        ).lower()

    def _topic_matches(topic: str, text: str) -> bool:
        topic = topic.strip().lower()
        if not topic or not text:
            return False
        if topic in text:
            return True
        keywords = _topic_keywords(topic)
        if not keywords:
            return False
        return any(kw in text for kw in keywords)

    def _topic_signal_counts(topic: str) -> tuple[int, int, int, int]:
        pos = neg = saves = 0
        for s in signals:
            text = _item_text(s)
            if not _topic_matches(topic, text):
                continue
            if s.signal_type == SignalType.saved:
                saves += 1
                pos += 1
            elif s.signal_type in pos_types:
                pos += 1
            elif s.signal_type in neg_types:
                neg += 1
        return pos, neg, saves, pos + neg

    def _topic_entry(topic: str, pos: int, neg: int, saves: int, tot: int, source: str) -> dict:
        return {
            "rate": round(pos / tot, 3) if tot else 0.0,
            "engaged": pos,
            "saves": saves,
            "skipped": neg,
            "total": tot,
            "ready": tot >= 2,
            "source": source,
        }

    topic_actual: dict[str, dict] = {}
    for topic in declared_topics:
        pos, neg, saves, tot = _topic_signal_counts(topic)
        if tot >= 1:
            topic_actual[topic] = _topic_entry(topic, pos, neg, saves, tot, "declared")

    # Discovered topics: learned from reading behaviour, not explicitly declared
    from briefly_api.services.profile_utils import cluster_label

    declared_set = set(declared_topics)
    discovered_candidates: list[str] = []
    for entry in (profile.topic_clusters or []):
        label = cluster_label(entry)
        if not label:
            continue
        key = label.lower()
        if key in declared_set:
            continue
        source = entry.get("source") or "inferred"
        strength = float(entry.get("strength", 0))
        item_count = int(entry.get("item_count", 0))
        if source in {"inferred", "learned"} or (strength >= 0.2 and item_count >= 1):
            discovered_candidates.append(key)

    for topic in dict.fromkeys(discovered_candidates):
        pos, neg, saves, tot = _topic_signal_counts(topic)
        if tot >= 1:
            topic_actual[topic] = _topic_entry(topic, pos, neg, saves, tot, "discovered")

    # Emerging topics: high-frequency words in saved/clicked headlines NOT
    # already covered by a declared interest
    emerging_counts: dict[str, int] = {}
    stop = {"that", "with", "this", "from", "have", "will", "been", "into",
            "they", "their", "about", "more", "after", "what", "when",
            "could", "would", "says", "your", "over", "here", "than",
            "announces", "announced", "equity", "capital", "expand",
            "compute", "alphabet", "million", "billion", "company",
            "market", "invest", "investors", "raises", "launch"}
    for s in signals:
        if s.signal_type not in pos_types or not s.headline:
            continue
        for word in s.headline.lower().split():
            word = word.strip(".,;:!?\"'()[]")
            if len(word) > 5 and word.isalpha() and word not in declared_word_set and word not in stop:
                emerging_counts[word] = emerging_counts.get(word, 0) + 1

    emerging_topics = [
        w for w, c in sorted(emerging_counts.items(), key=lambda x: x[1], reverse=True)
        if c >= 3
    ][:6]

    # Generate insight sentences
    insights: list[dict] = []

    # Engagement level insight
    if total >= 5:
        pct = round(overall_engagement * 100)
        if pct >= 60:
            insights.append({
                "type": "engagement",
                "label": "High signal reader",
                "text": f"You engage with {pct}% of what Briefly shows you — well above average. Your profile trains fast.",
            })
        elif pct >= 35:
            insights.append({
                "type": "engagement",
                "label": "Active reader",
                "text": f"You engage with {pct}% of your digest items. The {100 - pct}% you skip is just as valuable a signal.",
            })

    # Save habit
    if save_count >= 3:
        insights.append({
            "type": "saves",
            "label": f"{save_count} saves so far",
            "text": f"You've saved {save_count} articles. Briefly treats each save as a strong interest signal — it raises the weight of similar future stories.",
        })

    # Top source loyalty
    if source_engagement:
        top_src, top_rate = max(source_engagement.items(), key=lambda x: x[1])
        if top_rate >= 0.55:
            insights.append({
                "type": "source_loyalty",
                "label": f"{top_src.title()} — {round(top_rate * 100)}% engaged",
                "text": f"You open or save {round(top_rate * 100)}% of content from {top_src.title()}. Briefly now prioritises it above your other sources.",
            })

    # Divergence: topic you engage with more than you declared
    if topic_actual:
        top_topic = max(topic_actual.items(), key=lambda x: x[1]["rate"])
        top_name, top_data = top_topic
        # Only surface if it's notably above 50% and not the #1 declared topic
        if top_data["rate"] >= 0.6 and top_name != declared_topics[0]:
            insights.append({
                "type": "divergence",
                "label": "Behaviour ≠ declaration",
                "text": (
                    f"You engage with '{top_name}' content {round(top_data['rate']*100)}% of the time — "
                    f"higher than your top declared interest. Briefly has already shifted its weighting."
                ),
            })

    # Low-signal topic the user declared but rarely engages with
    if topic_actual:
        neglected = [
            (t, d) for t, d in topic_actual.items()
            if d["rate"] < 0.25 and d["total"] >= 3
        ]
        if neglected:
            t_name, t_data = neglected[0]
            insights.append({
                "type": "drift",
                "label": "Drifting topic detected",
                "text": (
                    f"You declared '{t_name}' as an interest but engage with it only {round(t_data['rate']*100)}% of the time. "
                    f"Briefly will gradually deprioritise it unless you re-engage."
                ),
            })

    latest_signal_at = max(
        (s.created_at for s in signals if s.created_at),
        default=None,
    )

    return {
        "total_signals":       total,
        "overall_engagement":  overall_engagement,
        "save_rate":           save_rate,
        "topic_actual":        topic_actual,
        "source_engagement":   source_engagement,
        "emerging_topics":     emerging_topics,
        "insights":            insights,
        "window_days":         45,
        "computed_at":         datetime.now(timezone.utc).isoformat(),
        "latest_signal_at":    latest_signal_at.isoformat() if latest_signal_at else None,
    }


# ── Profile intelligence ──────────────────────────────────────────────────────

@router.get("/profile/intelligence")
async def get_profile_intelligence(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Returns the accumulated intelligence Briefly has built about the user:
    strongest interests, moved-away-from topics, active story threads,
    prioritised and deprioritised sources.
    This is the data behind the 'Your Briefly Knows' card in settings.
    """
    from briefly_api.db.models import UserMemory, Source
    from briefly_api.services.profile_utils import cluster_label, _UUID_RE

    profile = user.profile
    if not profile:
        return {"digest_day": 0, "strongest_interests": [], "moved_away_from": [],
                "active_threads": [], "top_sources": [], "deprioritized_sources": []}

    # Digest day count
    digest_day = profile.total_digests_received or 0

    # Strongest interests from topic_clusters (lowered threshold so early users see data)
    clusters = profile.topic_clusters or []

    # Seed from declared interests when there are no VALID learned clusters.
    # We must check cluster_label() rather than the raw list length because
    # topic_clusters can contain stale section-label entries ("What's new",
    # "Highly relevant to you") from a previous bug — those all return None
    # from cluster_label() and produce empty topic_strengths even though the
    # list itself is non-empty.
    has_valid_clusters = any(cluster_label(c) for c in clusters)
    if not has_valid_clusters and profile.interests:
        clusters = [
            {
                "cluster": i.get("topic", ""),
                "strength": float(i.get("weight", 0.5)),
                "source": "declared",
                "item_count": 0,
            }
            for i in (profile.interests or [])
            if i.get("topic")
        ]

    strong = sorted(
        [c for c in clusters if cluster_label(c) and c.get("strength", 0) >= 0.25],
        key=lambda x: x.get("strength", 0),
        reverse=True,
    )
    strongest_interests = [cluster_label(c) for c in strong[:8] if cluster_label(c)]

    # Emerging interests (building up, not yet strong)
    emerging = sorted(
        [c for c in clusters if cluster_label(c) and 0.08 <= c.get("strength", 0) < 0.25],
        key=lambda x: x.get("strength", 0),
        reverse=True,
    )
    emerging_interests = [cluster_label(c) for c in emerging[:4] if cluster_label(c)]

    # All topic strengths for visual bar rendering in UI
    topic_strengths = {
        cluster_label(c): round(c.get("strength", 0), 3)
        for c in sorted(clusters, key=lambda x: x.get("strength", 0), reverse=True)
        if cluster_label(c) and c.get("strength", 0) > 0.05
    }

    # Topics the user has moved away from (low strength, was once higher)
    faded = sorted(
        [c for c in clusters if cluster_label(c) and c.get("strength", 1.0) < 0.2 and c.get("item_count", 0) > 0],
        key=lambda x: x.get("item_count", 0),
        reverse=True,
    )
    moved_away_from = [cluster_label(c) for c in faded[:3] if cluster_label(c)]

    # Active story threads
    thread_result = await db.execute(
        select(UserMemory)
        .where(
            UserMemory.user_id == user.id,
            UserMemory.memory_type == "story_thread",
        )
        .order_by(UserMemory.occurrence_count.desc())
        .limit(8)
    )
    threads = thread_result.scalars().all()
    active_threads = []
    for t in threads:
        val = t.value or {}
        from briefly_api.agents.learning import _days_since
        from datetime import datetime, timezone
        first_seen = val.get("first_seen", "")
        # Estimate weeks
        days = _days_since(first_seen) if first_seen else 0
        weeks = max(1, round(days / 7))
        active_threads.append({
            "topic": val.get("topic") or t.key,
            "weeks": weeks,
            "appearances": t.occurrence_count,
            "latest": val.get("latest_headline", "")[:100],
        })

    # Source weights — resolve UUID keys to human-readable names, then rank
    source_weights = dict(profile.source_weights or {})

    # Build UUID → name map for any keys that look like source IDs
    uuid_keys = [k for k in source_weights if _UUID_RE.match(k)]
    source_id_to_name: dict[str, str] = {}
    if uuid_keys:
        src_result = await db.execute(
            select(Source.id, Source.name)
            .where(Source.user_id == user.id, Source.id.in_(uuid_keys))
        )
        source_id_to_name = {str(r.id): r.name for r in src_result.all() if r.name}

    # Normalise: replace UUID keys with resolved names; skip unresolvable UUIDs
    resolved_weights: dict[str, float] = {}
    for k, v in source_weights.items():
        if _UUID_RE.match(k):
            name = source_id_to_name.get(k)
            if name:
                resolved_weights[name.lower()] = max(resolved_weights.get(name.lower(), 0.0), v)
        else:
            resolved_weights[k] = max(resolved_weights.get(k, 0.0), v)

    sorted_sources = sorted(resolved_weights.items(), key=lambda x: x[1], reverse=True)
    top_sources = [k for k, v in sorted_sources[:6] if v >= 0.35]
    deprioritized_sources = [k for k, v in sorted_sources if v < 0.25][:3]

    # Reading behaviour stats
    reading_stats = {
        "total_digests": profile.total_digests_received or 0,
        "avg_open_rate": round((profile.avg_open_rate or 0) * 100),
        "avg_click_rate": round((profile.avg_click_rate or 0) * 100),
    }

    # True when topic_strengths was seeded from declared interests rather than
    # learned clusters — lets the UI show "Based on what you told us" instead
    # of "Learned from your reading".
    interests_are_declared = bool(
        topic_strengths
        and all(c.get("source") == "declared" for c in clusters if cluster_label(c))
    )

    # Compute real behavioral intelligence from signal history
    behavioral = {}
    try:
        behavioral = await _compute_behavioral_intelligence(user.id, profile, db)
    except Exception as exc:
        log.warning("Behavioral intelligence computation failed: %s", exc)

    return {
        "digest_day": digest_day,
        "strongest_interests": strongest_interests,
        "emerging_interests": emerging_interests,
        "moved_away_from": moved_away_from,
        "active_threads": active_threads,
        "top_sources": top_sources,
        "deprioritized_sources": deprioritized_sources,
        "topic_strengths": topic_strengths,
        "reading_stats": reading_stats,
        "interests_are_declared": interests_are_declared,
        "behavioral": behavioral,
    }


# ── Weekly intelligence report ────────────────────────────────────────────────

@router.get("/weekly-report")
async def get_weekly_report(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Generate and return the weekly intelligence report data.
    Called by the frontend to display the Sunday report (or on demand).
    """
    from briefly_api.services.weekly_report import generate_weekly_report

    report = await generate_weekly_report(db, user.id)
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not enough data yet to generate a weekly report.",
        )
    return report


# ── Item feedback ─────────────────────────────────────────────────────────────

_SIGNAL_MAP: dict[str, SignalType] = {
    "liked":        SignalType.saved,
    "disliked":     SignalType.disliked,
    "clicked":      SignalType.clicked,
    "saved":        SignalType.saved,
    "skipped":      SignalType.skipped,
    "followed_up":  SignalType.followed_up,
    "opened":       SignalType.opened,
}


@router.post("/feedback", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def record_feedback(
    body: FeedbackIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    signal_type = _SIGNAL_MAP.get(body.signal_type)
    if not signal_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown signal_type '{body.signal_type}'. Use: liked, disliked, clicked, saved.",
        )

    # opened signal uses digest_item_id to carry digest_id (special case from frontend)
    if body.signal_type == "opened":
        db.add(BehavioralSignal(
            user_id=user.id,
            signal_type=SignalType.opened,
            digest_id=body.digest_id,
            meta=body.meta or {},
        ))
        await db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    item_result = await db.execute(
        select(DigestItem).where(
            DigestItem.id == body.digest_item_id,
        ).join(Digest, DigestItem.digest_id == Digest.id).where(
            Digest.user_id == user.id
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Digest item not found.")

    # Update the item flags
    if body.signal_type in ("liked", "saved"):
        item.was_saved = True
    elif body.signal_type == "disliked":
        item.was_disliked = True
    elif body.signal_type == "clicked":
        item.was_clicked = True
    elif body.signal_type == "followed_up":
        item.had_follow_up = True
        item.follow_up_depth = (item.follow_up_depth or 0) + 1

    # Store signal record
    db.add(BehavioralSignal(
        user_id=user.id,
        signal_type=signal_type,
        digest_id=body.digest_id,
        digest_item_id=body.digest_item_id,
        meta={"source_name": item.source_name, "source_url": item.source_url},
    ))

    # Update source weight in user profile for immediate effect on next briefing
    source_id: str | None = None
    if item.content_id:
        from briefly_api.db.models import RawContent

        rc = await db.get(RawContent, item.content_id)
        if rc:
            source_id = rc.source_id

    if item.source_name and user.profile:
        await _bump_source_weight(
            user, item.source_name, body.signal_type, db, source_id=source_id,
        )

    await db.commit()

    # ── Real-time signal processing (SignalMonitorAgent) ──────────────────────
    # Runs immediately after commit to update topic clusters + fingerprint.
    # Errors are swallowed — this must never break the feedback route.
    try:
        from briefly_api.workers.signal_processor import handle_signal
        asyncio.create_task(
            handle_signal(
                session=db,
                user_id=user.id,
                signal_type=signal_type,
                digest_item_id=body.digest_item_id,
                meta={"source_name": item.source_name},
            )
        )
    except Exception:
        pass

    # Click-to-discover: suggest RSS feeds via pending discovery on next scan —
    # no silent auto-add (user confirms sources before briefing).
    if body.signal_type == "clicked" and item.source_url:
        asyncio.create_task(
            _queue_click_discovery(user.id, item.source_url)
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _bump_source_weight(
    user: User,
    source_name: str,
    signal_type: str,
    db: AsyncSession,
    *,
    source_id: str | None = None,
) -> None:
    if not user.profile:
        return
    weights: dict = dict(user.profile.source_weights or {})
    key = source_id or source_name.lower()
    current = weights.get(key, 0.5)
    delta = 0.08 if signal_type == "liked" else -0.08 if signal_type == "disliked" else 0.02
    weights[key] = round(min(1.0, max(0.1, current + delta)), 3)
    user.profile.source_weights = weights


async def _queue_click_discovery(user_id: str, source_url: str) -> None:
    """After enough clicks on a domain, refresh pending discoveries (no auto-add)."""
    try:
        parsed = urlparse(source_url)
        domain = parsed.netloc.lstrip("www.").lower()
        if not domain:
            return

        from datetime import datetime, timedelta, timezone
        cutoff = datetime.now(timezone.utc) - timedelta(days=_CLICK_WINDOW_DAYS)

        async with SessionLocal() as db:
            click_count = await db.scalar(
                select(func.count())
                .select_from(BehavioralSignal)
                .where(
                    BehavioralSignal.user_id == user_id,
                    BehavioralSignal.signal_type == SignalType.clicked,
                    BehavioralSignal.meta["source_url"].as_string().contains(domain),
                    BehavioralSignal.created_at >= cutoff,
                )
            )
            if (click_count or 0) < _CLICK_DISCOVERY_THRESHOLD:
                return

            prof = await db.execute(
                select(UserProfile).where(UserProfile.user_id == user_id)
            )
            profile = prof.scalar_one_or_none()
            if not profile or profile.sources_discovery_confirmed_at is not None:
                return

            from briefly_api.services.source_discovery import run_source_discovery
            from briefly_api.config import get_settings
            await run_source_discovery(db, user_id, settings=get_settings())
            log.info("click_discover: refreshed pending discoveries for user %s (domain %s)", user_id, domain)

    except Exception:
        log.exception("click_discover: unexpected error for user %s url %s", user_id, source_url)


# ── Source suggestions ────────────────────────────────────────────────────────

@router.get("/sources/suggestions", response_model=list[SourceSuggestionOut])
async def get_source_suggestions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[SourceSuggestionOut]:
    from briefly_api.services.external_feed_discovery import discover_interest_suggestions_light

    existing = await db.execute(
        select(Source).where(Source.user_id == user.id)
    )
    already_added = {s.identifier.lower() for s in existing.scalars().all()}

    profile_dict = {}
    if user.profile:
        profile_dict = {
            "interests": user.profile.interests or [],
            "role": user.profile.role,
            "goal": user.profile.goal,
            "topic_clusters": user.profile.topic_clusters or [],
        }

    gmail = await get_gmail_connection(db, user.id)
    suggestions = await discover_interest_suggestions_light(
        profile_dict, settings, limit=8, gmail_connected=gmail is not None,
    )
    filtered = [s for s in suggestions if s["url"].lower() not in already_added]
    return [SourceSuggestionOut(**s) for s in filtered[:8]]


# ── Readwise integration ──────────────────────────────────────────────────────

@router.post("/auth/readwise/connect", response_model=SourceOut, status_code=status.HTTP_201_CREATED)
async def connect_readwise(
    body: ReadwiseConnectIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SourceOut:
    import httpx as _httpx

    # Validate the key works
    try:
        async with _httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://readwise.io/api/v2/auth/",
                headers={"Authorization": f"Token {body.api_key}"},
            )
        if resp.status_code != 204:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid Readwise API key.",
            )
    except _httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach Readwise API.",
        ) from exc

    existing = await db.execute(
        select(Source).where(
            Source.user_id == user.id,
            Source.source_type == "readwise",
        )
    )
    source = existing.scalar_one_or_none()
    if source:
        source.meta = {**(source.meta or {}), "api_key": body.api_key}
    else:
        source = Source(
            user_id=user.id,
            source_type="readwise",
            identifier="readwise",
            name="Readwise",
            meta={"api_key": body.api_key},
        )
        db.add(source)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Readwise already connected.")

    await db.refresh(source)
    return SourceOut.model_validate(source)


@router.delete("/auth/readwise", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def disconnect_readwise(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    result = await db.execute(
        select(Source).where(
            Source.user_id == user.id,
            Source.source_type == "readwise",
        )
    )
    source = result.scalar_one_or_none()
    if source:
        await db.delete(source)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
