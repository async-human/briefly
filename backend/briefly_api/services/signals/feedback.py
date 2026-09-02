"""Record founder labels on market signals for the precision baseline."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import MarketSignal, SignalFeedback
from briefly_api.services.signals.evidence import FEEDBACK_LABELS, normalize_label, precision_from_labels


async def record_signal_feedback(
    session: AsyncSession,
    *,
    user_id: str,
    signal_id: str,
    label: str,
    note: str | None = None,
) -> SignalFeedback:
    normalized = normalize_label(label)
    if not normalized:
        raise ValueError("Unknown signal label")
    row = SignalFeedback(
        user_id=user_id,
        signal_id=signal_id,
        label=normalized,
        note=(note or None),
    )
    session.add(row)
    signal = await session.get(MarketSignal, signal_id)
    if signal and signal.user_id == user_id:
        if normalized in ("useful", "acted_on"):
            signal.status = "verified"
        elif normalized in ("irrelevant", "duplicate", "incorrect"):
            signal.status = "discarded"
        # Re-rank a bounded recent window immediately. The feedback changes
        # priority, never evidence or factual state.
        from briefly_api.services.signals.ranking import recompute_recent_priorities

        await session.flush()
        await recompute_recent_priorities(session, user_id)
    return row


async def feedback_for_digest_item(
    session: AsyncSession,
    *,
    user_id: str,
    digest_item_id: str | None,
    source_url: str | None = None,
) -> MarketSignal | None:
    if digest_item_id:
        row = (
            await session.execute(
                select(MarketSignal).where(
                    MarketSignal.user_id == user_id,
                    MarketSignal.digest_item_id == digest_item_id,
                ).limit(1)
            )
        ).scalar_one_or_none()
        if row:
            return row
    if source_url:
        return (
            await session.execute(
                select(MarketSignal).where(
                    MarketSignal.user_id == user_id,
                    MarketSignal.source_url == source_url,
                ).limit(1)
            )
        ).scalar_one_or_none()
    return None


async def precision_summary(session: AsyncSession, user_id: str, days: int = 30) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    rows = (
        await session.execute(
            select(SignalFeedback)
            .where(
                SignalFeedback.user_id == user_id,
                SignalFeedback.created_at >= cutoff,
            )
            .order_by(SignalFeedback.created_at.asc())
        )
    ).scalars().all()
    latest: dict[str, str] = {}
    for row in rows:
        latest[row.signal_id] = row.label
    summary = precision_from_labels(list(latest.values()))
    summary["window_days"] = days
    summary["signals"] = len(latest)
    return summary
