"""
briefly_api/api/routes/watched.py

Watched entities — companies / topics / people the user wants real-time alerts
on ("tell me whenever Anthropic ships"). Matched by the watch monitor against
official blogs, Google News, GitHub, and the user's own pool.

  GET    /watched-entities              list (with unread counts)
  POST   /watched-entities              add (idempotent by name)
  DELETE /watched-entities/{id}         remove
  GET    /watched-alerts                recent alerts
  POST   /watched-alerts/{id}/read      mark one read
  POST   /watched-alerts/read-all       mark all read
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.db.engine import get_db
from briefly_api.db.models import BehavioralSignal, EntityAlert, SignalType, User, WatchedEntity
from briefly_api.services.watch.catalog import generate_aliases, match_terms_for, topic_terms

router = APIRouter(tags=["watched"])

_VALID_KINDS = {"company", "topic", "person", "product"}


class WatchedEntityOut(BaseModel):
    id: str
    name: str
    kind: str
    keywords: list[str]
    aliases: list[str] = []
    unread_count: int = 0
    relationship_to_user: str = "watch"


class WatchedEntityIn(BaseModel):
    name: str
    kind: str = "company"
    keywords: list[str] = []
    relationship_to_user: str = "watch"
    watch_reason: str | None = None


class EntityAlertOut(BaseModel):
    id: str
    entity_id: str
    entity_name: str
    entity_kind: str
    title: str
    summary: str
    what_changed: str
    why_it_matters: str
    action: str
    source_url: str
    source_name: str
    published_at: datetime | None
    relevance_score: float
    is_read: bool
    is_urgent: bool
    related_urls: list[str]
    sources_checked: int
    detector_type: str | None = None
    confidence: float = 0.0
    created_at: datetime | None


def _serialize_entity(r: WatchedEntity, unread: int = 0) -> WatchedEntityOut:
    return WatchedEntityOut(
        id=r.id,
        name=r.name,
        kind=r.kind,
        keywords=list(r.keywords or []),
        aliases=list(r.aliases or []),
        unread_count=unread,
        relationship_to_user=getattr(r, "relationship_to_user", None) or "watch",
    )


def _serialize_alert(row: EntityAlert, entity: WatchedEntity) -> EntityAlertOut:
    return EntityAlertOut(
        id=row.id,
        entity_id=row.entity_id,
        entity_name=entity.name,
        entity_kind=entity.kind,
        title=row.title,
        summary=row.summary or "",
        what_changed=row.what_changed or "",
        why_it_matters=row.why_it_matters or "",
        action=row.action or "",
        source_url=row.source_url,
        source_name=row.source_name or "",
        published_at=row.published_at,
        relevance_score=float(row.relevance_score or 0),
        is_read=bool(row.is_read),
        is_urgent=bool(row.is_urgent),
        related_urls=list(row.related_urls or []),
        sources_checked=int(row.sources_checked or 0),
        detector_type=getattr(row, "detector_type", None),
        confidence=float(getattr(row, "confidence", 0) or 0),
        created_at=row.created_at,
    )


async def _unread_map(db: AsyncSession, user_id: str) -> dict[str, int]:
    rows = (
        await db.execute(
            select(EntityAlert.entity_id, func.count())
            .where(EntityAlert.user_id == user_id, EntityAlert.is_read.is_(False))
            .group_by(EntityAlert.entity_id)
        )
    ).all()
    return {eid: int(n) for eid, n in rows}


@router.get("/watched-entities", response_model=list[WatchedEntityOut])
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
    unread = await _unread_map(db, user.id)
    return [_serialize_entity(r, unread.get(r.id, 0)) for r in rows]


@router.post("/watched-entities", response_model=WatchedEntityOut, status_code=status.HTTP_201_CREATED)
async def add_watched(
    body: WatchedEntityIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WatchedEntityOut:
    name = body.name.strip()
    kind = body.kind if body.kind in _VALID_KINDS else "company"
    keywords = [k.strip() for k in body.keywords if k.strip()]
    if kind == "topic":
        keywords = topic_terms(name, keywords)

    existing = (
        await db.execute(select(WatchedEntity).where(WatchedEntity.user_id == user.id))
    ).scalars().all()
    for r in existing:
        if r.name.lower() == name.lower():
            unread = await _unread_map(db, user.id)
            return _serialize_entity(r, unread.get(r.id, 0))

    aliases = generate_aliases(name, match_terms_for(name, kind, keywords, []))
    ent = WatchedEntity(
        user_id=user.id,
        name=name,
        kind=kind,
        keywords=keywords,
        aliases=aliases,
        is_active=True,
        relationship_to_user=(body.relationship_to_user or "watch")[:40],
        watch_reason=(body.watch_reason or None),
        monitoring_rules={
            "detectors": ["pricing_positioning", "model_api", "product_release"],
        },
    )
    db.add(ent)
    await db.flush()

    from briefly_api.services.watch.sources import seed_sources
    await seed_sources(db, ent)

    db.add(
        BehavioralSignal(
            user_id=user.id,
            signal_type=SignalType.tracked,
            meta={"entity": name, "kind": kind, "relationship": body.relationship_to_user},
        )
    )
    await db.commit()
    await db.refresh(ent)

    try:
        from briefly_api.services.background_jobs import enqueue_background_job
        await enqueue_background_job(
            "watch_scan",
            {"user_id": user.id, "entity_id": ent.id, "force": True},
        )
    except Exception:
        pass

    return _serialize_entity(ent, 0)


@router.delete("/watched-entities/{entity_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def remove_watched(
    entity_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await db.execute(
        delete(WatchedEntity).where(
            WatchedEntity.id == entity_id,
            WatchedEntity.user_id == user.id,
        )
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/watched-alerts", response_model=list[EntityAlertOut])
async def list_alerts(
    unread_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[EntityAlertOut]:
    stmt = (
        select(EntityAlert, WatchedEntity)
        .join(WatchedEntity, WatchedEntity.id == EntityAlert.entity_id)
        .where(EntityAlert.user_id == user.id)
        .order_by(EntityAlert.created_at.desc())
        .limit(limit)
    )
    if unread_only:
        stmt = stmt.where(EntityAlert.is_read.is_(False))
    rows = (await db.execute(stmt)).all()
    return [_serialize_alert(alert, ent) for alert, ent in rows]


class WatchScanOut(BaseModel):
    entities: int
    new_alerts: int
    alerts: list[EntityAlertOut]


@router.post("/watched-entities/scan", response_model=WatchScanOut)
async def scan_watched(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WatchScanOut:
    """Run a watch scan now (does not wait for the 15-minute worker)."""
    from briefly_api.services.watch.monitor import run_for_user

    result = await run_for_user(db, user.id, force=True)
    await db.commit()

    rows = (
        await db.execute(
            select(EntityAlert, WatchedEntity)
            .join(WatchedEntity, WatchedEntity.id == EntityAlert.entity_id)
            .where(EntityAlert.user_id == user.id)
            .order_by(EntityAlert.created_at.desc())
            .limit(20)
        )
    ).all()
    return WatchScanOut(
        entities=int(result.get("entities") or 0),
        new_alerts=int(result.get("alerts") or 0),
        alerts=[_serialize_alert(alert, ent) for alert, ent in rows],
    )


@router.post("/watched-alerts/{alert_id}/read", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def mark_alert_read(
    alert_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await db.execute(
        update(EntityAlert)
        .where(EntityAlert.id == alert_id, EntityAlert.user_id == user.id)
        .values(is_read=True)
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/watched-alerts/read-all", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def mark_all_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await db.execute(
        update(EntityAlert).where(EntityAlert.user_id == user.id).values(is_read=True)
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
