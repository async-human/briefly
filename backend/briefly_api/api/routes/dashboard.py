from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from urllib.parse import urlparse

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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
    result = await db.execute(
        select(Digest)
        .where(Digest.user_id == user.id)
        .order_by(Digest.digest_date.desc())
        .limit(limit)
    )
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
    user: User = Depends(get_current_user),
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

            digest, warnings = await generate_briefing_now(user, session, get_settings())
            await report_briefing_progress(
                user_id,
                status="complete",
                step="done",
                label="Briefing ready!",
                digest_id=digest.id,
                warnings=warnings,
            )
        except ValueError as exc:
            log.warning("Briefing worker failed for user %s: %s", user_id, exc)
            await report_briefing_progress(
                user_id,
                status="error",
                step="error",
                label="Briefing failed.",
                error=str(exc),
            )
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


@router.get("/digests/generate/status", response_model=BriefingGenerationStatusOut)
async def get_briefing_generation_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BriefingGenerationStatusOut:
    profile = user.profile
    if not profile:
        return BriefingGenerationStatusOut(status="idle")

    meta = profile.ingestion_meta or {}
    gen = dict(meta.get("briefing_generation") or {"status": "idle"})

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
            digest_out = DigestOut.model_validate(digest)

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
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GenerateDigestOut:
    prof = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
    profile = prof.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    meta = dict(profile.ingestion_meta or {})
    gen = meta.get("briefing_generation") or {}
    if gen.get("status") == "running":
        return GenerateDigestOut(status="running", digest=None, warnings=[])

    now = datetime.now(timezone.utc).isoformat()
    meta["briefing_generation"] = {
        "status": "running",
        "step": "start",
        "label": "Starting briefing generation…",
        "started_at": now,
        "updated_at": now,
    }
    profile.ingestion_meta = meta
    await db.commit()

    background_tasks.add_task(_briefing_worker, user.id)
    return GenerateDigestOut(status="running", digest=None, warnings=[])


@router.get("/ingestion/summary", response_model=IngestionSummaryOut)
async def get_ingestion_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> IngestionSummaryOut:
    from datetime import datetime, timedelta, timezone

    from briefly_api.db.models import ContentStatus, RawContent

    profile = user.profile
    meta = dict(profile.ingestion_meta or {}) if profile else {}
    last_summary = meta.get("last_summary") or {}
    feed = list(profile.activity_feed or [])[:10] if profile else []

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
    from briefly_api.services.content_ingestion import ingest_user_sources

    summary = await ingest_user_sources(db, user.id, settings=settings)
    prof = await db.execute(
        select(UserProfile).where(UserProfile.user_id == user.id)
    )
    profile = prof.scalar_one_or_none()
    return IngestionSummaryOut(
        last_ingestion_at=profile.last_ingestion_at if profile else None,
        last_summary=summary.to_dict(),
        activity_feed=list(profile.activity_feed or [])[:10] if profile else [],
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
    added: list[Source] = []
    skipped = 0

    for item in body.sources:
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


# ── Item feedback ─────────────────────────────────────────────────────────────

_SIGNAL_MAP: dict[str, SignalType] = {
    "liked":    SignalType.saved,
    "disliked": SignalType.disliked,
    "clicked":  SignalType.clicked,
    "saved":    SignalType.saved,
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
    if body.signal_type == "liked":
        item.was_saved = True
    elif body.signal_type == "disliked":
        item.was_disliked = True
    elif body.signal_type == "clicked":
        item.was_clicked = True

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
