"""Link market signals to digest items and pin watching hits into the brief."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select

from briefly_api.db.models import DigestItem, MarketSignal, SignalEvidence, SignalFeedback, UserProfile, WatchedEntity
from briefly_api.services.signals.detectors import DETECTOR_TYPES, classify_change
from briefly_api.services.signals.evidence import (
    bundle_from_item,
    bundle_from_signal,
    evidence_piece,
    url_key,
    watching_alert_item_kwargs,
)
from briefly_api.services.signals.persist import persist_market_signal

log = logging.getLogger(__name__)


async def pin_watching_alerts(session, digest_id: str, ctx) -> int:
    """Insert unread watching alerts as digest items when the URL is not already in the brief."""
    alerts = [a for a in (getattr(ctx, "watching_alerts", None) or []) if isinstance(a, dict)]
    if not alerts:
        return 0
    existing = (
        await session.execute(select(DigestItem).where(DigestItem.digest_id == digest_id))
    ).scalars().all()
    taken = {url_key(item.source_url) for item in existing if item.source_url}
    profile = getattr(getattr(ctx, "user", None), "profile", None) or {}
    pinned: list[tuple[dict[str, Any], DigestItem]] = []
    for alert in alerts:
        key = url_key(alert.get("source_url"))
        if not key or key in taken:
            continue
        if (alert.get("source_url") or "").startswith("pool:"):
            continue
        taken.add(key)
        fields = watching_alert_item_kwargs(alert, profile)
        item = DigestItem(digest_id=digest_id, position=0, **fields)
        pinned.append((alert, item))
    if not pinned:
        return 0
    shift = len(pinned)
    for item in existing:
        item.position = (item.position or 0) + shift
    for index, (_alert, item) in enumerate(pinned, start=1):
        item.position = index
        session.add(item)
    await session.flush()
    log.info("Pinned %d watching alerts into digest %s", len(pinned), digest_id)
    return len(pinned)


async def link_signals_to_digest(session, user_id: str, digest_id: str) -> int:
    """Set MarketSignal.digest_item_id by URL; create signals for detector hits."""
    items = (
        await session.execute(select(DigestItem).where(DigestItem.digest_id == digest_id))
    ).scalars().all()
    if not items:
        return 0

    entities = (
        await session.execute(
            select(WatchedEntity).where(
                WatchedEntity.user_id == user_id,
                WatchedEntity.is_active.is_(True),
            )
        )
    ).scalars().all()

    urls = [item.source_url for item in items if item.source_url]
    existing_signals = []
    if urls:
        existing_signals = (
            await session.execute(
                select(MarketSignal).where(
                    MarketSignal.user_id == user_id,
                    MarketSignal.source_url.in_(urls),
                )
            )
        ).scalars().all()
    by_url = {url_key(row.source_url): row for row in existing_signals if row.source_url}

    linked = 0
    profile_row = (
        await session.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    ).scalar_one_or_none()
    profile = dict(getattr(profile_row, "operating_context", None) or {}) if profile_row else {}
    for item in items:
        key = url_key(item.source_url)
        if not key:
            continue
        signal = by_url.get(key)
        if signal:
            if not signal.digest_item_id:
                signal.digest_item_id = item.id
                linked += 1
            continue
        entity = _matching_entity(item, entities)
        if not entity:
            continue
        detector = classify_change(
            title=item.headline or "",
            summary=item.summary or "",
            entity_name=entity.name,
            entity_kind=entity.kind,
        )
        if detector.detector_type not in DETECTOR_TYPES:
            continue
        alert_id = None
        breakdown = dict(item.score_breakdown or {})
        if isinstance(breakdown.get("watch_alert_id"), str):
            alert_id = breakdown["watch_alert_id"]
        try:
            async with session.begin_nested():
                signal_id = await persist_market_signal(
                    session,
                    user_id=user_id,
                    entity_id=entity.id,
                    title=item.headline or "",
                    source_url=item.source_url or "",
                    source_name=item.source_name or "",
                    published_at=None,
                    detector=detector,
                    what_changed=item.summary or item.headline or "",
                    why_it_matters=item.why_it_matters or "",
                    action=item.suggested_action or "",
                    operating_context=profile or None,
                    alert_id=alert_id,
                    related_urls=[
                        str(extra.get("url"))
                        for extra in (item.all_sources or [])
                        if isinstance(extra, dict) and extra.get("url")
                    ],
                    relevance_score=float(item.relevance_score or 0),
                    is_urgent=False,
                )
        except Exception:
            log.debug("link_signals_to_digest: persist failed", exc_info=True)
            continue
        if not signal_id:
            continue
        row = await session.get(MarketSignal, signal_id)
        if row:
            row.digest_item_id = item.id
            by_url[key] = row
            linked += 1
    return linked


def _matching_entity(item: DigestItem, entities: list[WatchedEntity]) -> WatchedEntity | None:
    blob = f"{item.headline or ''} {item.summary or ''}".lower()
    for entity in entities:
        needles = {entity.name.lower(), *[a.lower() for a in (entity.aliases or []) if a]}
        needles = {n for n in needles if len(n) >= 3}
        if any(n in blob for n in needles):
            return entity
    return None


async def evidence_for_items(session, user_id: str, items: list[DigestItem]) -> dict[str, dict[str, Any]]:
    """Map digest_item_id → evidence bundle (signal-backed, else citations)."""
    if not items:
        return {}
    item_ids = [item.id for item in items]
    urls = [item.source_url for item in items if item.source_url]
    stmt = select(MarketSignal).where(MarketSignal.user_id == user_id)
    if urls:
        from sqlalchemy import or_

        evidence_ids = select(SignalEvidence.signal_id).where(SignalEvidence.source_url.in_(urls))
        stmt = stmt.where(
            or_(
                MarketSignal.digest_item_id.in_(item_ids),
                MarketSignal.source_url.in_(urls),
                MarketSignal.id.in_(evidence_ids),
            )
        )
    else:
        stmt = stmt.where(MarketSignal.digest_item_id.in_(item_ids))
    signals = (await session.execute(stmt)).scalars().all()
    by_item: dict[str, MarketSignal] = {}
    by_url: dict[str, MarketSignal] = {url_key(s.source_url): s for s in signals if s.source_url}
    for signal in signals:
        if signal.digest_item_id:
            by_item[signal.digest_item_id] = signal

    signal_ids = [s.id for s in signals]
    evidence_rows: list[SignalEvidence] = []
    labels: dict[str, str] = {}
    if signal_ids:
        evidence_rows = (
            await session.execute(
                select(SignalEvidence).where(SignalEvidence.signal_id.in_(signal_ids))
            )
        ).scalars().all()
        feedback_rows = (
            await session.execute(
                select(SignalFeedback)
                .where(
                    SignalFeedback.user_id == user_id,
                    SignalFeedback.signal_id.in_(signal_ids),
                )
                .order_by(SignalFeedback.created_at.asc())
            )
        ).scalars().all()
        for row in feedback_rows:
            labels[row.signal_id] = row.label

    pieces_by_signal: dict[str, list[dict[str, Any]]] = {}
    for row in evidence_rows:
        pieces_by_signal.setdefault(row.signal_id, []).append(
            evidence_piece(
                source_url=row.source_url,
                source_name=row.source_name,
                extracted_claim=row.extracted_claim,
                supporting_passage=row.supporting_passage,
                published_at=row.published_at,
                is_contradictory=bool(row.is_contradictory),
            )
        )
        if row.source_url:
            signal = next((s for s in signals if s.id == row.signal_id), None)
            if signal:
                by_url[url_key(row.source_url)] = signal

    out: dict[str, dict[str, Any]] = {}
    for item in items:
        signal = by_item.get(item.id) or by_url.get(url_key(item.source_url))
        if signal:
            pieces = pieces_by_signal.get(signal.id) or [
                evidence_piece(
                    source_url=signal.source_url,
                    extracted_claim=signal.new_state or signal.title,
                    supporting_passage=signal.what_changed,
                )
            ]
            if getattr(item, "contradiction_flag", False) and item.contradiction_explanation:
                pieces.append(
                    evidence_piece(
                        source_url=item.source_url or signal.source_url,
                        source_name="Earlier brief",
                        extracted_claim=item.contradiction_explanation[:500],
                        supporting_passage=item.contradiction_explanation[:800],
                        is_contradictory=True,
                    )
                )
            out[item.id] = bundle_from_signal(
                signal_id=signal.id,
                detector_type=signal.detector_type,
                confidence=signal.confidence,
                previous_state=signal.previous_state,
                new_state=signal.new_state or item.headline,
                is_material_change=signal.is_material_change,
                is_state_change=signal.is_state_change,
                event_fingerprint=signal.event_fingerprint,
                pieces=pieces,
                label=labels.get(signal.id),
            )
        else:
            out[item.id] = bundle_from_item(item)
    return out
