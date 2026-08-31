"""Persist a classified watch hit as signal + evidence + impact."""
from __future__ import annotations

import logging
import uuid

from sqlalchemy.dialects.postgresql import insert as pg_insert

from briefly_api.db.models import MarketSignal, SignalEvidence, SignalImpact
from briefly_api.services.operating_context import questions_hit_by_text
from briefly_api.services.signals.detectors import DetectorResult

log = logging.getLogger(__name__)


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
) -> str | None:
    """Insert a market signal (idempotent on user+entity+url). Returns id or None."""
    if not source_url:
        return None
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
            previous_state=detector.previous_state[:500],
            new_state=detector.new_state[:500],
            confidence=float(detector.confidence or 0),
            status="candidate",
            source_url=source_url,
            alert_id=alert_id,
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
    session.add(
        SignalImpact(
            signal_id=inserted,
            user_id=user_id,
            why_it_matters=(why_it_matters or "")[:800],
            who_affected="",
            recommended_action=(action or "")[:400],
            strategic_questions_hit=hits,
            confidence=float(detector.confidence or 0),
        )
    )
    log.debug(
        "Market signal %s detector=%s entity=%s",
        inserted, detector.detector_type, entity_id,
    )
    return inserted
