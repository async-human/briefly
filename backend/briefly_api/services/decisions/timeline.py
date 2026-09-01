"""Decision timeline — temporal read model for decision threads.

Surfaces belief edits, verified signal impacts, and confidence movement as
ordered events for Settings and Ask retrieval.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from sqlalchemy import select

TimelineEventType = Literal["belief_edit", "confidence_change", "signal"]


def _event_type(update: Any) -> TimelineEventType:
    note = (update.note or "").strip().lower()
    if note == "belief edited":
        return "belief_edit"
    if update.signal_id:
        return "signal"
    return "confidence_change"


async def get_thread_timeline(
    session,
    user_id: str,
    thread_id: str,
    *,
    days: int = 90,
) -> list[dict[str, Any]]:
    from briefly_api.db.models import (
        BeliefAssessment,
        DecisionThread,
        MarketSignal,
        SignalEvidence,
        ThreadSignal,
        ThreadUpdate,
    )
    from briefly_api.services.decisions.threads import get_thread

    thread = await get_thread(session, user_id, thread_id)
    if not thread:
        return []

    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))

    updates = (
        await session.execute(
            select(ThreadUpdate)
            .where(
                ThreadUpdate.thread_id == thread_id,
                ThreadUpdate.created_at >= since,
            )
            .order_by(ThreadUpdate.created_at.asc())
        )
    ).scalars().all()

    link_rows = (
        await session.execute(
            select(ThreadSignal, MarketSignal, BeliefAssessment)
            .join(MarketSignal, MarketSignal.id == ThreadSignal.signal_id)
            .outerjoin(
                BeliefAssessment,
                (BeliefAssessment.thread_id == ThreadSignal.thread_id)
                & (BeliefAssessment.signal_id == ThreadSignal.signal_id),
            )
            .where(ThreadSignal.thread_id == thread_id)
            .order_by(MarketSignal.detected_at.asc())
        )
    ).all()

    signal_ids = [sig.id for _link, sig, _assess in link_rows]
    evidence_by_signal: dict[str, list[dict[str, str]]] = {}
    if signal_ids:
        evidence_rows = (
            await session.execute(
                select(SignalEvidence).where(SignalEvidence.signal_id.in_(signal_ids))
            )
        ).scalars().all()
        for row in evidence_rows:
            evidence_by_signal.setdefault(row.signal_id, []).append(
                {
                    "url": row.source_url,
                    "passage": (row.supporting_passage or row.extracted_claim or "")[:500],
                    "source_name": row.source_name or "",
                }
            )

    events: list[dict[str, Any]] = []
    update_signal_ids = {u.signal_id for u in updates if u.signal_id}

    for update in updates:
        events.append(
            {
                "at": update.created_at,
                "type": _event_type(update),
                "belief": (update.belief or "").strip() or None,
                "confidence": update.confidence,
                "previous_confidence": update.previous_confidence,
                "note": (update.note or "").strip() or None,
                "signal_id": update.signal_id,
                "headline": None,
                "stance": None,
                "rationale": None,
                "evidence": [],
            }
        )

    for link, signal, assessment in link_rows:
        if signal.id in update_signal_ids:
            continue
        if signal.detected_at and signal.detected_at < since:
            continue
        events.append(
            {
                "at": signal.detected_at or signal.created_at,
                "type": "signal",
                "belief": None,
                "confidence": None,
                "previous_confidence": None,
                "note": link.stance if link.stance != "related" else None,
                "signal_id": signal.id,
                "headline": (signal.title or "").strip() or None,
                "stance": assessment.stance if assessment else link.stance,
                "rationale": (assessment.rationale or "").strip() if assessment else None,
                "evidence": evidence_by_signal.get(signal.id, [])[:3],
            }
        )

    events.sort(key=lambda e: e["at"] or datetime.min.replace(tzinfo=timezone.utc))
    return events
