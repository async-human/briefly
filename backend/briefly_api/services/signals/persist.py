"""Persist a classified watch hit as signal + evidence + impact."""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from briefly_api.db.models import MarketSignal, SignalEvidence, SignalImpact
from briefly_api.services.operating_context import questions_hit_by_text, who_affected_from_context
from briefly_api.services.signals.detectors import DetectorResult
from briefly_api.services.watch.relevance import canonicalize_url

log = logging.getLogger(__name__)


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
) -> str | None:
    """Insert a market signal (idempotent on user+entity+url). Returns id or None."""
    if not source_url:
        return None
    previous = detector.previous_state or await prior_state_for(
        session,
        user_id=user_id,
        entity_id=entity_id,
        detector_type=detector.detector_type,
        source_url=source_url,
    )
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
            new_state=detector.new_state[:500],
            confidence=float(detector.confidence or 0),
            status="candidate",
            source_url=source_url,
            alert_id=alert_id,
            digest_item_id=digest_item_id,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "entity_id", "source_url"])
        .returning(MarketSignal.id)
    )
    inserted = (await session.execute(stmt)).scalar_one_or_none()
    if not inserted:
        return None

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

        await link_signal_to_threads(
            session,
            user_id=user_id,
            signal_id=inserted,
            blob=blob,
            previous_state=previous,
            new_state=detector.new_state,
        )
    except Exception:
        log.exception("Failed to link signal %s to decision threads", inserted)
    return inserted
