"""Persist a classified watch hit as signal + evidence + impact."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from briefly_api.db.models import MarketSignal, SignalEvidence, SignalImpact
from briefly_api.services.operating_context import questions_hit_by_text, who_affected_from_context
from briefly_api.services.signals.detectors import DETECTOR_TYPES, DetectorResult
from briefly_api.services.watch.relevance import canonicalize_url

log = logging.getLogger(__name__)
_MATERIAL_CONFIDENCE = 0.55
_MATERIAL_RELEVANCE = 0.70


def is_material_signal(
    *,
    detector_type: str,
    detector_confidence: float,
    relevance_score: float,
    is_urgent: bool,
    why_it_matters: str,
) -> bool:
    """Require both change confidence and company relevance before surfacing."""
    return bool(
        detector_type in DETECTOR_TYPES
        and float(detector_confidence or 0) >= _MATERIAL_CONFIDENCE
        and (is_urgent or float(relevance_score or 0) >= _MATERIAL_RELEVANCE)
        and (why_it_matters or "").strip()
    )


async def _matching_existing_signal(
    session,
    *,
    user_id: str,
    entity_id: str | None,
    detector_type: str,
    proposed_state: str,
) -> MarketSignal | None:
    """Find an already-recorded event described by different coverage."""
    if not entity_id or not proposed_state:
        return None
    from briefly_api.services.signals.snapshots import same_observation

    rows = (
        await session.execute(
            select(MarketSignal)
            .where(
                MarketSignal.user_id == user_id,
                MarketSignal.entity_id == entity_id,
                MarketSignal.detector_type == detector_type,
                MarketSignal.detected_at >= datetime.now(timezone.utc) - timedelta(days=21),
            )
            .order_by(MarketSignal.detected_at.desc())
            .limit(20)
        )
    ).scalars().all()
    return next(
        (
            row for row in rows
            if same_observation(row.new_state or row.title, proposed_state)
        ),
        None,
    )


async def _add_corroborating_evidence(
    session,
    *,
    signal: MarketSignal,
    source_url: str,
    source_name: str,
    detector: DetectorResult,
    published_at,
) -> None:
    exists = (
        await session.execute(
            select(SignalEvidence.id).where(
                SignalEvidence.signal_id == signal.id,
                SignalEvidence.source_url == source_url,
            ).limit(1)
        )
    ).scalar_one_or_none()
    if exists:
        return
    session.add(
        SignalEvidence(
            signal_id=signal.id,
            source_url=source_url,
            source_name=(source_name or "")[:200],
            extracted_claim=detector.extracted_claim[:500],
            supporting_passage=detector.supporting_passage[:800],
            published_at=published_at,
            is_contradictory=False,
        )
    )


async def prior_state_for(
    session,
    *,
    user_id: str,
    entity_id: str | None,
    detector_type: str,
    source_url: str,
) -> str:
    """Last observed new_state for this entity+detector, excluding this URL."""
    if not entity_id:
        return ""
    row = (
        await session.execute(
            select(MarketSignal.new_state)
            .where(
                MarketSignal.user_id == user_id,
                MarketSignal.entity_id == entity_id,
                MarketSignal.detector_type == detector_type,
                MarketSignal.source_url != source_url,
                MarketSignal.new_state != "",
            )
            .order_by(MarketSignal.detected_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return (row or "")[:500]


async def persist_market_signal(
    session,
    *,
    user_id: str,
    entity_id: str | None,
    title: str,
    source_url: str,
    source_name: str,
    published_at,
    detector: DetectorResult,
    what_changed: str,
    why_it_matters: str,
    action: str,
    operating_context: dict | None,
    alert_id: str | None = None,
    related_urls: list[str] | None = None,
    digest_item_id: str | None = None,
    relevance_score: float = 0.0,
    is_urgent: bool = False,
) -> str | None:
    """Insert a market event or attach corroborating evidence. Returns its id."""
    if not source_url:
        return None
    from briefly_api.services.signals.snapshots import (
        event_fingerprint,
        record_snapshot,
        resolve_states,
    )

    proposed_state = (
        detector.new_state or detector.extracted_claim or title
    ).strip()[:500]
    existing_event = await _matching_existing_signal(
        session,
        user_id=user_id,
        entity_id=entity_id,
        detector_type=detector.detector_type,
        proposed_state=proposed_state,
    )
    if existing_event:
        await _add_corroborating_evidence(
            session,
            signal=existing_event,
            source_url=source_url,
            source_name=source_name,
            detector=detector,
            published_at=published_at,
        )
        if digest_item_id and not existing_event.digest_item_id:
            existing_event.digest_item_id = digest_item_id
        return existing_event.id

    write_snapshot = False
    if detector.detector_type in DETECTOR_TYPES and entity_id:
        previous, new_state, write_snapshot = await resolve_states(
            session,
            user_id=user_id,
            entity_id=entity_id,
            aspect=detector.detector_type,
            proposed_new=proposed_state,
            source_url=source_url,
        )
        if detector.previous_state:
            previous = detector.previous_state[:500]
    else:
        previous = detector.previous_state or await prior_state_for(
            session,
            user_id=user_id,
            entity_id=entity_id,
            detector_type=detector.detector_type,
            source_url=source_url,
        )
        new_state = (detector.new_state or "")[:500]
    previous = (previous or "")[:500]
    new_state = (new_state or "")[:500]
    is_state_change = bool(previous and new_state and previous.lower() != new_state.lower())
    is_material_change = is_material_signal(
        detector_type=detector.detector_type,
        detector_confidence=float(detector.confidence or 0),
        relevance_score=float(relevance_score or 0),
        is_urgent=is_urgent,
        why_it_matters=why_it_matters,
    )
    fingerprint = event_fingerprint(detector.detector_type, new_state or proposed_state, source_url)
    signal_id = str(uuid.uuid4())
    stmt = (
        pg_insert(MarketSignal)
        .values(
            id=signal_id,
            user_id=user_id,
            entity_id=entity_id,
            detector_type=detector.detector_type,
            title=(title or "")[:500],
            what_changed=(what_changed or detector.extracted_claim)[:800],
            previous_state=previous[:500],
            new_state=new_state[:500],
            confidence=float(detector.confidence or 0),
            status="candidate",
            source_url=source_url,
            event_fingerprint=fingerprint,
            is_material_change=is_material_change,
            is_state_change=is_state_change,
            alert_id=alert_id,
            digest_item_id=digest_item_id,
        )
        .on_conflict_do_nothing()
        .returning(MarketSignal.id)
    )
    inserted = (await session.execute(stmt)).scalar_one_or_none()
    if not inserted:
        concurrent = (
            await session.execute(
                select(MarketSignal).where(
                    MarketSignal.user_id == user_id,
                    MarketSignal.entity_id == entity_id,
                    MarketSignal.event_fingerprint == fingerprint,
                ).limit(1)
            )
        ).scalar_one_or_none()
        if not concurrent:
            return None
        await _add_corroborating_evidence(
            session,
            signal=concurrent,
            source_url=source_url,
            source_name=source_name,
            detector=detector,
            published_at=published_at,
        )
        return concurrent.id

    blob = f"{title} {what_changed} {why_it_matters}"
    hits = questions_hit_by_text(operating_context, blob)
    session.add(
        SignalEvidence(
            signal_id=inserted,
            source_url=source_url,
            source_name=(source_name or "")[:200],
            extracted_claim=detector.extracted_claim[:500],
            supporting_passage=detector.supporting_passage[:800],
            published_at=published_at,
            is_contradictory=False,
        )
    )
    seen = {canonicalize_url(source_url).lower()}
    for extra in related_urls or []:
        url = (extra or "").strip()
        if not url or url.startswith("pool:"):
            continue
        key = canonicalize_url(url).lower() or url.lower()
        if key in seen:
            continue
        seen.add(key)
        session.add(
            SignalEvidence(
                signal_id=inserted,
                source_url=url[:2000],
                source_name="",
                extracted_claim="",
                supporting_passage="",
                published_at=published_at,
                is_contradictory=False,
            )
        )
    session.add(
        SignalImpact(
            signal_id=inserted,
            user_id=user_id,
            why_it_matters=(why_it_matters or "")[:800],
            who_affected=who_affected_from_context(operating_context)[:240],
            recommended_action=(action or "")[:400],
            strategic_questions_hit=hits,
            confidence=float(detector.confidence or 0),
        )
    )
    log.debug(
        "Market signal %s detector=%s entity=%s",
        inserted, detector.detector_type, entity_id,
    )
    try:
        from briefly_api.services.decisions.threads import link_signal_to_threads

        async with session.begin_nested():
            await link_signal_to_threads(
                session,
                user_id=user_id,
                signal_id=inserted,
                blob=blob,
                previous_state=previous,
                new_state=new_state,
            )
    except Exception:
        log.exception("Failed to link signal %s to decision threads", inserted)
    if write_snapshot and entity_id:
        try:
            async with session.begin_nested():
                await record_snapshot(
                    session,
                    user_id=user_id,
                    entity_id=entity_id,
                    aspect=detector.detector_type,
                    state_text=new_state,
                    source_url=source_url,
                    signal_id=inserted,
                    effective_at=published_at,
                    fingerprint=fingerprint,
                )
        except Exception:
            log.exception("Failed to record entity snapshot for signal %s", inserted)
    return inserted
