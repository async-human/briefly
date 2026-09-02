"""Transparent, feedback-aware priority for decision signals.

The ranker is deliberately small and inspectable. It learns bounded preferences
from founder labels while keeping evidence quality and materiality in control;
one accidental dismissal can never erase a verified change.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from sqlalchemy import func, select


_LABEL_VALUE = {
    "useful": 1.0,
    "acted_on": 1.35,
    "irrelevant": -1.0,
    "duplicate": -0.65,
    "incorrect": -1.4,
}
_PRIOR_STRENGTH = 5.0
_MAX_LEARNED_ADJUSTMENT = 0.14


@dataclass(frozen=True)
class PreferenceProfile:
    detector: dict[str, tuple[float, int]] = field(default_factory=dict)
    entity: dict[str, tuple[float, int]] = field(default_factory=dict)
    domain: dict[str, tuple[float, int]] = field(default_factory=dict)
    labeled: int = 0


def source_domain(url: str | None) -> str:
    try:
        return (urlparse(url or "").hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def _learned_value(profile: PreferenceProfile, detector: str, entity_id: str | None, domain: str) -> tuple[float, int]:
    groups = [profile.detector.get(detector)]
    if entity_id:
        groups.append(profile.entity.get(entity_id))
    if domain:
        groups.append(profile.domain.get(domain))
    present = [row for row in groups if row and row[1] > 0]
    if not present:
        return 0.0, 0
    weighted_sum = sum(total for total, _count in present)
    count = sum(count for _total, count in present)
    posterior = weighted_sum / (count + _PRIOR_STRENGTH)
    return max(-_MAX_LEARNED_ADJUSTMENT, min(_MAX_LEARNED_ADJUSTMENT, posterior * 0.12)), count


def score_signal(
    *,
    confidence: float,
    relevance: float,
    evidence_count: int,
    is_material_change: bool,
    is_state_change: bool,
    is_urgent: bool,
    decision_connected: bool,
    detector_type: str,
    entity_id: str | None,
    source_url: str,
    profile: PreferenceProfile | None = None,
) -> tuple[float, dict]:
    """Return a 0–1 priority and user-facing factors.

    Weights sum to one before the bounded learned adjustment. This makes score
    movement understandable and stable across small feedback samples.
    """
    profile = profile or PreferenceProfile()
    conf = max(0.0, min(1.0, float(confidence or 0)))
    rel = max(0.0, min(1.0, float(relevance or 0)))
    evidence = min(max(0, int(evidence_count)), 3) / 3
    learned, learned_samples = _learned_value(
        profile, detector_type, entity_id, source_domain(source_url)
    )
    components = {
        "change_confidence": round(conf * 0.28, 4),
        "company_relevance": round(rel * 0.25, 4),
        "evidence_strength": round(evidence * 0.12, 4),
        "material_change": 0.10 if is_material_change else 0.0,
        "state_change": 0.08 if is_state_change else 0.0,
        "decision_connection": 0.12 if decision_connected else 0.0,
        "urgent": 0.05 if is_urgent else 0.0,
        "learned_adjustment": round(learned, 4),
    }
    score = max(0.0, min(1.0, sum(components.values())))
    strongest = sorted(
        ((key, value) for key, value in components.items() if value > 0 and key != "learned_adjustment"),
        key=lambda row: row[1],
        reverse=True,
    )[:3]
    labels = {
        "change_confidence": "high-confidence change",
        "company_relevance": "strong company fit",
        "evidence_strength": "corroborated evidence",
        "material_change": "material movement",
        "state_change": "verified before/after state",
        "decision_connection": "connected to an active decision",
        "urgent": "time-sensitive",
    }
    reasons = [labels[key] for key, _value in strongest]
    if learned_samples:
        reasons = reasons[:2] + ["adapted from your signal ratings"]
    return round(score, 4), {
        "version": "transparent-v1",
        "components": components,
        "reasons": reasons[:3],
        "feedback_samples": learned_samples,
    }


async def load_preference_profile(session, user_id: str, *, days: int = 120) -> PreferenceProfile:
    from briefly_api.db.models import MarketSignal, SignalFeedback

    cutoff = datetime.now(timezone.utc) - timedelta(days=max(30, min(days, 365)))
    rows = (
        await session.execute(
            select(SignalFeedback.signal_id, SignalFeedback.label, MarketSignal.detector_type, MarketSignal.entity_id, MarketSignal.source_url)
            .join(MarketSignal, MarketSignal.id == SignalFeedback.signal_id)
            .where(SignalFeedback.user_id == user_id, SignalFeedback.created_at >= cutoff)
            .order_by(SignalFeedback.created_at.asc())
        )
    ).all()
    detector: dict[str, list[float]] = {}
    entity: dict[str, list[float]] = {}
    domain: dict[str, list[float]] = {}
    latest: dict[str, tuple[str, str | None, str, float]] = {}
    # The query can contain multiple ratings per signal; later rows are the current intent.
    # Keying by the stable feature tuple prevents repeat clicks from overpowering the prior.
    for signal_id, label, detector_type, entity_id, source_url in rows:
        value = _LABEL_VALUE.get(label)
        if value is None:
            continue
        latest[signal_id] = (detector_type, entity_id, source_url, value)
    for detector_type, entity_id, source_url, value in latest.values():
        detector.setdefault(detector_type, []).append(value)
        if entity_id:
            entity.setdefault(entity_id, []).append(value)
        host = source_domain(source_url)
        if host:
            domain.setdefault(host, []).append(value)
    collapse = lambda groups: {key: (sum(values), len(values)) for key, values in groups.items()}
    return PreferenceProfile(collapse(detector), collapse(entity), collapse(domain), len(latest))


async def recompute_recent_priorities(session, user_id: str, *, limit: int = 80) -> int:
    from briefly_api.db.models import MarketSignal, SignalEvidence, ThreadSignal

    profile = await load_preference_profile(session, user_id)
    rows = (
        await session.execute(
            select(
                MarketSignal,
                func.count(func.distinct(SignalEvidence.id)),
                func.count(func.distinct(ThreadSignal.id)),
            )
            .outerjoin(SignalEvidence, SignalEvidence.signal_id == MarketSignal.id)
            .outerjoin(ThreadSignal, ThreadSignal.signal_id == MarketSignal.id)
            .where(MarketSignal.user_id == user_id)
            .group_by(MarketSignal.id)
            .order_by(MarketSignal.detected_at.desc())
            .limit(max(1, min(limit, 200)))
        )
    ).all()
    for signal, evidence_count, thread_count in rows:
        stored = dict(signal.ranking_factors or {})
        score, factors = score_signal(
            confidence=signal.confidence,
            relevance=float(stored.get("raw_relevance") or 0),
            evidence_count=int(evidence_count or 0),
            is_material_change=bool(signal.is_material_change),
            is_state_change=bool(signal.is_state_change),
            is_urgent=bool(stored.get("raw_urgent")),
            decision_connected=bool(thread_count),
            detector_type=signal.detector_type,
            entity_id=signal.entity_id,
            source_url=signal.source_url,
            profile=profile,
        )
        factors["raw_relevance"] = float(stored.get("raw_relevance") or 0)
        factors["raw_urgent"] = bool(stored.get("raw_urgent"))
        signal.priority_score = score
        signal.ranking_factors = factors
    return len(rows)
