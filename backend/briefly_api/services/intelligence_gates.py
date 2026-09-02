"""Cross-account evidence for roadmap gates.

Every metric carries its denominator and can be insufficient. This endpoint is
for operating the product, not decorating it with optimistic percentages.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select


def gate_metric(*, value: float | None, target: float, direction: str, numerator: int, denominator: int, minimum_sample: int) -> dict[str, Any]:
    status = "insufficient_data"
    if denominator >= minimum_sample and value is not None:
        passed = value >= target if direction == "at_least" else value <= target
        status = "pass" if passed else "fail"
    return {
        "value": round(value, 3) if value is not None else None,
        "target": target,
        "direction": direction,
        "numerator": numerator,
        "denominator": denominator,
        "minimum_sample": minimum_sample,
        "status": status,
    }


async def build_intelligence_gate_scorecard(session, *, days: int = 30) -> dict[str, Any]:
    from briefly_api.db.models import (
        BehavioralSignal,
        DecisionOutcome,
        MarketSignal,
        SignalEvidence,
        SignalFeedback,
        User,
    )

    now = datetime.now(timezone.utc)
    since = now - timedelta(days=max(7, min(days, 120)))

    signal_rows = (
        await session.execute(
            select(MarketSignal)
            .where(MarketSignal.detected_at >= since, MarketSignal.is_material_change.is_(True))
            .order_by(MarketSignal.user_id, MarketSignal.priority_score.desc(), MarketSignal.detected_at.desc())
        )
    ).scalars().all()
    top_ids: list[str] = []
    per_user: dict[str, int] = {}
    for signal in signal_rows:
        count = per_user.get(signal.user_id, 0)
        if count >= 5:
            continue
        per_user[signal.user_id] = count + 1
        top_ids.append(signal.id)

    latest_labels: dict[str, str] = {}
    if top_ids:
        feedback = (
            await session.execute(
                select(SignalFeedback)
                .where(SignalFeedback.signal_id.in_(top_ids), SignalFeedback.created_at >= since)
                .order_by(SignalFeedback.created_at.asc())
            )
        ).scalars().all()
        for row in feedback:
            latest_labels[row.signal_id] = row.label
    positive = sum(label in {"useful", "acted_on"} for label in latest_labels.values())
    negative = sum(label in {"irrelevant", "duplicate", "incorrect"} for label in latest_labels.values())
    labeled = positive + negative

    evidence_count = 0
    if top_ids:
        evidence_count = int((await session.execute(
            select(func.count(func.distinct(SignalEvidence.signal_id))).where(
                SignalEvidence.signal_id.in_(top_ids),
                SignalEvidence.source_url != "",
            )
        )).scalar_one() or 0)

    paid_users = (
        await session.execute(
            select(User).where(User.plan == "pro", User.subscribed_at.is_not(None))
        )
    ).scalars().all()
    # Mature cohorts only: activity in each account's day 23–37 window. This is
    # deliberately stricter than "active sometime after signup".
    eligible_paid = [u for u in paid_users if u.subscribed_at and u.subscribed_at <= now - timedelta(days=37)]
    active_user_ids: set[str] = set()
    if eligible_paid:
        eligible_ids = [u.id for u in eligible_paid]
        earliest = min(u.subscribed_at for u in eligible_paid if u.subscribed_at) + timedelta(days=23)
        activity_rows = (
            await session.execute(
                select(BehavioralSignal.user_id, BehavioralSignal.created_at).where(
                    BehavioralSignal.user_id.in_(eligible_ids),
                    BehavioralSignal.created_at >= earliest,
                )
            )
        ).all()
        outcome_rows = (
            await session.execute(
                select(DecisionOutcome.user_id, DecisionOutcome.created_at).where(
                    DecisionOutcome.user_id.in_(eligible_ids),
                    DecisionOutcome.created_at >= earliest,
                )
            )
        ).all()
        subscribed = {u.id: u.subscribed_at for u in eligible_paid}
        for user_id, at in [*activity_rows, *outcome_rows]:
            start = subscribed[user_id] + timedelta(days=23)
            end = subscribed[user_id] + timedelta(days=37)
            if start <= at <= end:
                active_user_ids.add(user_id)

    weekly_outcome_users = int((await session.execute(
        select(func.count(func.distinct(DecisionOutcome.user_id))).where(
            DecisionOutcome.created_at >= now - timedelta(days=7),
            DecisionOutcome.outcome.in_(["changed", "confirmed", "action_planned", "acted"]),
        )
    )).scalar_one() or 0)
    active_paid = sum(u.id in active_user_ids for u in eligible_paid)

    metrics = {
        "top5_precision": gate_metric(
            value=positive / labeled if labeled else None,
            target=0.75, direction="at_least", numerator=positive,
            denominator=labeled, minimum_sample=20,
        ),
        "false_positive_rate": gate_metric(
            value=negative / labeled if labeled else None,
            target=0.15, direction="at_most", numerator=negative,
            denominator=labeled, minimum_sample=20,
        ),
        "evidence_coverage": gate_metric(
            value=evidence_count / len(top_ids) if top_ids else None,
            target=0.95, direction="at_least", numerator=evidence_count,
            denominator=len(top_ids), minimum_sample=20,
        ),
        "paid_d30_retention": gate_metric(
            value=active_paid / len(eligible_paid) if eligible_paid else None,
            target=0.40, direction="at_least", numerator=active_paid,
            denominator=len(eligible_paid), minimum_sample=10,
        ),
    }
    statuses = [metric["status"] for metric in metrics.values()]
    overall = "pass" if statuses and all(s == "pass" for s in statuses) else (
        "fail" if any(s == "fail" for s in statuses) else "insufficient_data"
    )
    return {
        "generated_at": now.isoformat(),
        "window_days": days,
        "phase_1_gate": overall,
        "metrics": metrics,
        "operating": {
            "material_signals": len(signal_rows),
            "top5_signals": len(top_ids),
            "labeled_top5_signals": labeled,
            "weekly_users_with_decision_outcome": weekly_outcome_users,
            "paid_accounts": len(paid_users),
        },
        "notes": [
            "Top-5 is evaluated per account from stored learned priority.",
            "Unlabeled signals remain visible in sample size but do not count as positive or negative.",
            "D30 paid retention is activity during each mature paid cohort's day 23–37 window.",
            "Phase 3 actions remain locked until every Phase 1 metric passes with its minimum sample.",
        ],
    }
