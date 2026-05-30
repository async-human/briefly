from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, status
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
    GenerateDigestOut,
    GmailDiscoverOut,
    GmailSenderOut,
    MeOut,
    ProfileOut,
    ReadwiseConnectIn,
    SourceCreate,
    SourceDetectOut,
    SourceOut,
    SourceSuggestionOut,
    UserOut,
)
from briefly_api.auth.gmail import get_gmail_connection, refresh_gmail_access_token
from briefly_api.auth.youtube import get_youtube_connection
from briefly_api.auth.reddit import get_reddit_connection
from briefly_api.auth.deps import get_current_user
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import (
    BehavioralSignal, Digest, DigestItem, SignalType, Source, User,
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


@router.get("/me", response_model=MeOut)
async def get_me(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db),
) -> MeOut:
    ingestion_email = f"{user.email_token}@{settings.email_ingestion_domain}"
    profile = ProfileOut.model_validate(user.profile) if user.profile else None
    gmail = await get_gmail_connection(db, user.id)
    youtube = await get_youtube_connection(db, user.id)
    reddit = await get_reddit_connection(db, user.id)
    return MeOut(
        user=UserOut.model_validate(user),
        profile=profile,
        ingestion_email=ingestion_email,
        onboarding_completed=bool(user.profile and user.profile.onboarding_completed),
        gmail_connected=gmail is not None,
        youtube_connected=youtube is not None,
        reddit_connected=reddit is not None,
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


@router.post("/digests/generate", response_model=GenerateDigestOut)
async def generate_digest_now(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> GenerateDigestOut:
    from briefly_api.services.briefing import generate_briefing_now

    try:
        digest, warnings = await generate_briefing_now(user, db, settings)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Briefing generation failed: {exc}",
        ) from exc
    return GenerateDigestOut(digest=DigestOut.model_validate(digest), warnings=warnings)


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

    senders = await discover_newsletter_senders(access_token, already_added)
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
    if item.source_name and user.profile:
        await _bump_source_weight(user, item.source_name, body.signal_type, db)

    await db.commit()

    # Click-to-discover: if the user has clicked articles from the same domain
    # enough times, automatically probe for an RSS feed and add it as a source.
    if body.signal_type == "clicked" and item.source_url:
        asyncio.create_task(
            _maybe_discover_from_click(user.id, item.source_url)
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _bump_source_weight(
    user: User,
    source_name: str,
    signal_type: str,
    db: AsyncSession,
) -> None:
    weights: dict = dict(user.profile.source_weights if hasattr(user.profile, "source_weights") else {})
    # Use source_name as key since we don't always have source_id on the item
    key = source_name.lower()
    current = weights.get(key, 0.5)
    delta = 0.08 if signal_type == "liked" else -0.08 if signal_type == "disliked" else 0.02
    weights[key] = round(min(1.0, max(0.1, current + delta)), 3)

    # source_weights lives inside the profile JSONB interests field indirectly;
    # store it in the profile meta via a dedicated approach
    if user.profile:
        # We store source weights as a top-level key in interests JSONB for now
        # (the profile has no dedicated column but we can carry it in topic_clusters meta)
        existing_clusters = list(user.profile.topic_clusters or [])
        # Find and update or append a synthetic "source_weight" marker
        sw_entry = next((c for c in existing_clusters if c.get("_type") == "source_weight"), None)
        if sw_entry:
            sw_entry["weights"] = weights
        else:
            existing_clusters.append({"_type": "source_weight", "weights": weights})
        user.profile.topic_clusters = existing_clusters


async def _maybe_discover_from_click(user_id: str, source_url: str) -> None:
    """
    Confidence-gated click-to-discover:
    Count how many times this user has clicked articles from the same domain
    in the past _CLICK_WINDOW_DAYS days.  Once the count reaches
    _CLICK_DISCOVERY_THRESHOLD, probe the domain for an RSS feed and
    auto-create a Source record.

    Runs as a fire-and-forget background task — never blocks the HTTP response.
    """
    try:
        parsed = urlparse(source_url)
        domain = parsed.netloc.lstrip("www.").lower()
        if not domain:
            return

        from datetime import datetime, timedelta, timezone
        cutoff = datetime.now(timezone.utc) - timedelta(days=_CLICK_WINDOW_DAYS)

        async with SessionLocal() as db:
            # Count clicks for any URL containing this domain
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

            # Don't add if a source for this domain already exists
            existing = await db.scalar(
                select(func.count())
                .select_from(Source)
                .where(
                    Source.user_id == user_id,
                    Source.identifier.contains(domain),
                )
            )
            if existing:
                return

            # Probe the domain for an RSS feed
            rss_url = await discover_rss_feed(f"https://{domain}")
            if not rss_url:
                log.debug("click_discover: no RSS found for %s (user %s)", domain, user_id)
                return

            try:
                source = Source(
                    user_id=user_id,
                    source_type="rss",
                    identifier=rss_url,
                    name=domain,
                    meta={
                        "auto_discovered": True,
                        "discovery_method": "click_signal",
                        "confidence": 0.6,
                        "trigger_domain": domain,
                        "click_count": click_count,
                    },
                )
                db.add(source)
                await db.commit()
                log.info(
                    "click_discover: auto-added RSS '%s' for user %s after %d click(s)",
                    rss_url, user_id, click_count,
                )
            except IntegrityError:
                await db.rollback()  # race condition — another task already added it

    except Exception:
        log.exception("click_discover: unexpected error for user %s url %s", user_id, source_url)


# ── Source suggestions ────────────────────────────────────────────────────────

@router.get("/sources/suggestions", response_model=list[SourceSuggestionOut])
async def get_source_suggestions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SourceSuggestionOut]:
    from briefly_api.services.source_catalog import get_suggestions

    existing = await db.execute(
        select(Source).where(Source.user_id == user.id)
    )
    already_added = {s.identifier for s in existing.scalars().all()}

    interests = []
    if user.profile and user.profile.interests:
        interests = [i.get("topic", "") for i in user.profile.interests]

    suggestions = get_suggestions(interests, already_added, limit=8)
    return [SourceSuggestionOut(**s) for s in suggestions]


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
