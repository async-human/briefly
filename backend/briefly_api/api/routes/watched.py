"""
briefly_api/api/routes/watched.py

Watched entities — companies / topics / people the user wants real-time alerts
on ("tell me whenever Anthropic ships"). Matched against fresh content by the
content watcher.

  GET    /watched-entities          list
  POST   /watched-entities          add (idempotent by name)
  DELETE /watched-entities/{id}     remove
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.db.engine import get_db
from briefly_api.db.models import User, WatchedEntity

router = APIRouter(prefix="/watched-entities", tags=["watched"])

_VALID_KINDS = {"company", "topic", "person"}


class WatchedEntityOut(BaseModel):
    id: str
    name: str
    kind: str
    keywords: list[str]


class WatchedEntityIn(BaseModel):
    name: str
    kind: str = "company"
    keywords: list[str] = []


def _serialize(r: WatchedEntity) -> WatchedEntityOut:
    return WatchedEntityOut(id=r.id, name=r.name, kind=r.kind, keywords=list(r.keywords or []))


@router.get("", response_model=list[WatchedEntityOut])
async def list_watched(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WatchedEntityOut]:
    rows = (
        await db.execute(
            select(WatchedEntity)
            .where(WatchedEntity.user_id == user.id)
            .order_by(WatchedEntity.created_at.desc())
        )
    ).scalars().all()
    return [_serialize(r) for r in rows]


@router.post("", response_model=WatchedEntityOut, status_code=status.HTTP_201_CREATED)
async def add_watched(
    body: WatchedEntityIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WatchedEntityOut:
    name = body.name.strip()
    kind = body.kind if body.kind in _VALID_KINDS else "company"

    existing = (
        await db.execute(select(WatchedEntity).where(WatchedEntity.user_id == user.id))
    ).scalars().all()
    for r in existing:
        if r.name.lower() == name.lower():
            return _serialize(r)

    ent = WatchedEntity(
        user_id=user.id,
        name=name,
        kind=kind,
        keywords=[k.strip() for k in body.keywords if k.strip()],
    )
    db.add(ent)
    await db.commit()
    await db.refresh(ent)
    return _serialize(ent)


@router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_watched(
    entity_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await db.execute(
        delete(WatchedEntity).where(
            WatchedEntity.id == entity_id,
            WatchedEntity.user_id == user.id,
        )
    )
    await db.commit()
