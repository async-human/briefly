from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.api.schemas import (
    DigestOut,
    DigestSummaryOut,
    GenerateDigestOut,
    MeOut,
    ProfileOut,
    SourceCreate,
    SourceDetectOut,
    SourceOut,
    UserOut,
)
from briefly_api.auth.gmail import get_gmail_connection
from briefly_api.auth.youtube import get_youtube_connection
from briefly_api.auth.reddit import get_reddit_connection
from briefly_api.auth.deps import get_current_user
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import Digest, Source, User
from briefly_api.services.connectors.registry import detect_source, get_connector
from briefly_api.services.connectors.types import ALL_SOURCE_TYPES

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
