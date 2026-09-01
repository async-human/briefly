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

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.db.engine import get_db
from briefly_api.db.models import BehavioralSignal, EntityAlert, MarketSignal, SignalType, User, WatchedEntity
from briefly_api.services.watch.catalog import generate_aliases, match_terms_for, topic_terms

router = APIRouter(tags=["watched"])

_VALID_KINDS = {"company", "topic", "person", "product"}


class EntityStateOut(BaseModel):
    aspect: str
    label: str
    state: str
    value: str | None = None
    unit: str | None = None
    effective_at: datetime | None = None
    observed_at: datetime | None = None


class WatchedEntityOut(BaseModel):
    id: str
    name: str
    kind: str
    keywords: list[str]
    aliases: list[str] = []
    unread_count: int = 0
    relationship_to_user: str = "watch"
    last_states: list[EntityStateOut] = []


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
    signal_id: str | None = None
    previous_state: str = ""
    new_state: str = ""
    is_material_change: bool = False
    is_state_change: bool = False
    signal_label: str | None = None
    evidence: list[dict] = Field(default_factory=list)
    decision_thread_id: str | None = None
    decision_title: str | None = None
    decision_belief: str | None = None
    decision_confidence: float | None = None
    decision_previous_confidence: float | None = None
    decision_status: str | None = None
    decision_stance: str | None = None
    created_at: datetime | None


def _serialize_entity(
    r: WatchedEntity,
    unread: int = 0,
    last_states: list | None = None,
) -> WatchedEntityOut:
    return WatchedEntityOut(
        id=r.id,
        name=r.name,
        kind=r.kind,
        keywords=list(r.keywords or []),
        aliases=list(r.aliases or []),
        unread_count=unread,
        relationship_to_user=getattr(r, "relationship_to_user", None) or "watch",
        last_states=[EntityStateOut.model_validate(s) for s in (last_states or [])],
    )


def _serialize_alert(
    row: EntityAlert,
    entity: WatchedEntity,
    *,
    signal_id: str | None = None,
    previous_state: str = "",
    new_state: str = "",
    is_material_change: bool = False,
    is_state_change: bool = False,
    signal_label: str | None = None,
    evidence: list[dict] | None = None,
    thread: dict | None = None,
) -> EntityAlertOut:
    from briefly_api.services.decisions.threads import digest_fields

    extra = digest_fields(thread)
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
        signal_id=signal_id,
        previous_state=previous_state,
        new_state=new_state,
        is_material_change=is_material_change,
        is_state_change=is_state_change,
        signal_label=signal_label,
        evidence=list(evidence or []),
        created_at=row.created_at,
        **extra,
    )


async def _alert_signal_map(db: AsyncSession, user_id: str, alerts: list[EntityAlert]) -> dict[str, dict]:
    if not alerts:
        return {}
    alert_ids = [a.id for a in alerts]
    urls = [a.source_url for a in alerts if a.source_url]
    from sqlalchemy import or_
    from briefly_api.db.models import SignalEvidence, SignalFeedback

    stmt = select(MarketSignal).where(MarketSignal.user_id == user_id)
    if urls:
        evidence_ids = select(SignalEvidence.signal_id).where(SignalEvidence.source_url.in_(urls))
        stmt = stmt.where(
            or_(
                MarketSignal.alert_id.in_(alert_ids),
                MarketSignal.source_url.in_(urls),
                MarketSignal.id.in_(evidence_ids),
            )
        )
    else:
        stmt = stmt.where(MarketSignal.alert_id.in_(alert_ids))
    signals = (await db.execute(stmt)).scalars().all()
    if not signals:
        return {}
    from briefly_api.services.signals.evidence import bundle_from_signal, evidence_piece

    signal_ids = [s.id for s in signals]
    pieces_rows = (
        await db.execute(select(SignalEvidence).where(SignalEvidence.signal_id.in_(signal_ids)))
    ).scalars().all()
    pieces_by: dict[str, list[dict]] = {}
    for row in pieces_rows:
        pieces_by.setdefault(row.signal_id, []).append(
            evidence_piece(
                source_url=row.source_url,
                source_name=row.source_name,
                extracted_claim=row.extracted_claim,
                supporting_passage=row.supporting_passage,
                published_at=row.published_at,
                is_contradictory=bool(row.is_contradictory),
            )
        )
    labels: dict[str, str] = {}
    feedback_rows = (
        await db.execute(
            select(SignalFeedback)
            .where(SignalFeedback.user_id == user_id, SignalFeedback.signal_id.in_(signal_ids))
            .order_by(SignalFeedback.created_at.asc())
        )
    ).scalars().all()
    for row in feedback_rows:
        labels[row.signal_id] = row.label

    by_alert: dict[str, dict] = {}
    by_url: dict[str, dict] = {}
    for signal in signals:
        bundle = bundle_from_signal(
            signal_id=signal.id,
            detector_type=signal.detector_type,
            confidence=signal.confidence,
            previous_state=signal.previous_state,
            new_state=signal.new_state,
            is_material_change=signal.is_material_change,
            is_state_change=signal.is_state_change,
            event_fingerprint=signal.event_fingerprint,
            pieces=pieces_by.get(signal.id) or [],
            label=labels.get(signal.id),
        )
        if signal.alert_id:
            by_alert[signal.alert_id] = bundle
        if signal.source_url:
            by_url[signal.source_url] = bundle
        for piece in pieces_by.get(signal.id) or []:
            if piece.get("source_url"):
                by_url[str(piece["source_url"])] = bundle
    out: dict[str, dict] = {}
    for alert in alerts:
        bundle = by_alert.get(alert.id) or by_url.get(alert.source_url)
        if bundle:
            out[alert.id] = bundle
    return out


async def _thread_snaps_for_bundles(db: AsyncSession, user_id: str, bundles: dict[str, dict]) -> dict[str, dict]:
    signal_ids = [str(b["signal_id"]) for b in bundles.values() if b.get("signal_id")]
    if not signal_ids:
        return {}
    try:
        from briefly_api.services.decisions.threads import snapshots_for_signals

        return await snapshots_for_signals(db, user_id, signal_ids)
    except Exception:
        return {}


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
    snaps: dict[str, list] = {}
    try:
        from briefly_api.services.signals.snapshots import latest_by_entities

        snaps = await latest_by_entities(db, user.id, [r.id for r in rows])
    except Exception:
        snaps = {}
    return [_serialize_entity(r, unread.get(r.id, 0), snaps.get(r.id) or []) for r in rows]


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
    alerts = [alert for alert, _ent in rows]
    bundles = await _alert_signal_map(db, user.id, alerts)
    snaps = await _thread_snaps_for_bundles(db, user.id, bundles)
    out: list[EntityAlertOut] = []
    for alert, ent in rows:
        bundle = bundles.get(alert.id) or {}
        sid = bundle.get("signal_id")
        out.append(
            _serialize_alert(
                alert,
                ent,
                signal_id=sid,
                previous_state=bundle.get("previous_state") or "",
                new_state=bundle.get("new_state") or "",
                is_material_change=bool(bundle.get("is_material_change")),
                is_state_change=bool(bundle.get("is_state_change")),
                signal_label=bundle.get("label"),
                evidence=list(bundle.get("pieces") or []),
                thread=snaps.get(str(sid)) if sid else None,
            )
        )
    return out


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
    alerts = [alert for alert, _ent in rows]
    bundles = await _alert_signal_map(db, user.id, alerts)
    snaps = await _thread_snaps_for_bundles(db, user.id, bundles)
    serialized: list[EntityAlertOut] = []
    for alert, ent in rows:
        bundle = bundles.get(alert.id) or {}
        sid = bundle.get("signal_id")
        serialized.append(
            _serialize_alert(
                alert,
                ent,
                signal_id=sid,
                previous_state=bundle.get("previous_state") or "",
                new_state=bundle.get("new_state") or "",
                is_material_change=bool(bundle.get("is_material_change")),
                is_state_change=bool(bundle.get("is_state_change")),
                signal_label=bundle.get("label"),
                evidence=list(bundle.get("pieces") or []),
                thread=snaps.get(str(sid)) if sid else None,
            )
        )
    return WatchScanOut(
        entities=int(result.get("entities") or 0),
        new_alerts=int(result.get("alerts") or 0),
        alerts=serialized,
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


class SignalFeedbackIn(BaseModel):
    label: str
    note: str | None = None


class SignalFeedbackOut(BaseModel):
    ok: bool = True
    label: str
    signal_id: str
    learned_message: str | None = None


@router.post("/signals/{signal_id}/feedback", response_model=SignalFeedbackOut)
async def rate_signal(
    signal_id: str,
    body: SignalFeedbackIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SignalFeedbackOut:
    from briefly_api.services.feedback_learned import build_learned_message
    from briefly_api.services.signals.feedback import record_signal_feedback

    signal = await db.get(MarketSignal, signal_id)
    if not signal or signal.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Signal not found.")
    try:
        row = await record_signal_feedback(
            db,
            user_id=user.id,
            signal_id=signal_id,
            label=body.label,
            note=body.note,
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown label. Use: useful, irrelevant, duplicate, incorrect, acted_on.",
        ) from None
    await db.commit()
    learned = build_learned_message(row.label, source_name=signal.title, headline=signal.title)
    return SignalFeedbackOut(label=row.label, signal_id=signal_id, learned_message=learned)


@router.get("/signals/eval")
async def signal_eval(
    days: int = Query(30, ge=1, le=90),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from briefly_api.services.signals.feedback import precision_summary

    return await precision_summary(db, user.id, days=days)
