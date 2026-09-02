"""Durable decision outcomes — the learning edge between evidence and action."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

VALID_OUTCOMES = frozenset({"changed", "confirmed", "action_planned", "acted", "no_change"})
VALID_SOURCES = frozenset({"glance", "read", "ask", "timeline"})
_SIGNAL_LABEL = {
    "changed": "useful",
    "confirmed": "useful",
    "action_planned": "acted_on",
    "acted": "acted_on",
    "no_change": "irrelevant",
}


async def record_decision_outcome(
    session,
    *,
    user_id: str,
    outcome: str,
    thread_id: str | None = None,
    signal_id: str | None = None,
    digest_item_id: str | None = None,
    source: str = "read",
    note: str | None = None,
    action: str | None = None,
):
    from briefly_api.db.models import DecisionOutcome, DecisionThread, Digest, DigestItem, MarketSignal
    from briefly_api.services.signals.feedback import record_signal_feedback

    normalized = (outcome or "").strip().lower()
    if normalized not in VALID_OUTCOMES:
        raise ValueError("Unknown decision outcome")
    source = source if source in VALID_SOURCES else "read"

    if thread_id:
        owned_thread = (
            await session.execute(
                select(DecisionThread.id).where(
                    DecisionThread.id == thread_id, DecisionThread.user_id == user_id
                )
            )
        ).scalar_one_or_none()
        if not owned_thread:
            raise ValueError("Decision thread not found")

    signal = None
    if signal_id:
        signal = (
            await session.execute(
                select(MarketSignal).where(
                    MarketSignal.id == signal_id, MarketSignal.user_id == user_id
                )
            )
        ).scalar_one_or_none()
        if not signal:
            raise ValueError("Signal not found")
    elif digest_item_id:
        signal = (
            await session.execute(
                select(MarketSignal).where(
                    MarketSignal.user_id == user_id,
                    MarketSignal.digest_item_id == digest_item_id,
                ).limit(1)
            )
        ).scalar_one_or_none()
        signal_id = signal.id if signal else None

    if digest_item_id:
        owned_item = (
            await session.execute(
                select(DigestItem.id)
                .join(Digest, Digest.id == DigestItem.digest_id)
                .where(DigestItem.id == digest_item_id, Digest.user_id == user_id)
            )
        ).scalar_one_or_none()
        if not owned_item:
            raise ValueError("Brief item not found")

    if not any((thread_id, signal_id, digest_item_id)):
        raise ValueError("An outcome must reference a decision, signal, or brief item")

    # Button retries are idempotent for the same decision moment.
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    existing = (
        await session.execute(
            select(DecisionOutcome).where(
                DecisionOutcome.user_id == user_id,
                DecisionOutcome.outcome == normalized,
                DecisionOutcome.thread_id == thread_id,
                DecisionOutcome.signal_id == signal_id,
                DecisionOutcome.digest_item_id == digest_item_id,
                DecisionOutcome.created_at >= cutoff,
            ).limit(1)
        )
    ).scalar_one_or_none()
    if existing:
        return existing

    row = DecisionOutcome(
        user_id=user_id,
        thread_id=thread_id,
        signal_id=signal_id,
        digest_item_id=digest_item_id,
        outcome=normalized,
        source=source,
        note=(note or "").strip()[:800] or None,
        action=(action or "").strip()[:800] or None,
    )
    session.add(row)
    await session.flush()

    if signal_id:
        await record_signal_feedback(
            session,
            user_id=user_id,
            signal_id=signal_id,
            label=_SIGNAL_LABEL[normalized],
            note=f"decision_outcome:{normalized}",
        )
    return row


def outcome_dict(row) -> dict:
    return {
        "id": row.id,
        "thread_id": row.thread_id,
        "signal_id": row.signal_id,
        "digest_item_id": row.digest_item_id,
        "outcome": row.outcome,
        "source": row.source,
        "note": row.note,
        "action": row.action,
        "created_at": row.created_at,
    }
