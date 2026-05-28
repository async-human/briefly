from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.api.schemas import DigestOut, DigestSummaryOut, MeOut, ProfileOut, SourceCreate, SourceOut, UserOut
from briefly_api.auth.deps import get_current_user
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import Digest, Source, SourceType, User

router = APIRouter(tags=["dashboard"])


@router.get("/me", response_model=MeOut)
async def get_me(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> MeOut:
    ingestion_email = f"{user.email_token}@{settings.email_ingestion_domain}"
    profile = ProfileOut.model_validate(user.profile) if user.profile else None
    return MeOut(
        user=UserOut.model_validate(user),
        profile=profile,
        ingestion_email=ingestion_email,
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


@router.post("/sources", response_model=SourceOut, status_code=status.HTTP_201_CREATED)
async def create_source(
    body: SourceCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SourceOut:
    try:
        source_type = SourceType(body.source_type)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid source type") from exc

    source = Source(
        user_id=user.id,
        source_type=source_type,
        identifier=body.identifier.strip(),
        name=body.name,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return SourceOut.model_validate(source)
