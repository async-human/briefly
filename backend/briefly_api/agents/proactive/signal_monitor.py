"""
briefly_api/agents/proactive/signal_monitor.py

SignalMonitorAgent — event-driven; fires on every behavioral signal.

Responsibilities:
  1. Immediately reinforce/decay topic cluster strengths for high-intent signals
     (followed_up, saved) without waiting for the nightly LearningAgent
  2. Rebuild the BehavioralFingerprint when enough signals have accumulated or
     when a high-intent signal triggers a significant profile shift
  3. Detect when a user's follow-up depth on a topic crosses the "tracking"
     threshold → queue a ProactiveSurfacingEvent ("voice note connection")

Called directly from the API signal route after a signal is recorded.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from briefly_api.config import get_settings
from briefly_api.db.models import (
    BehavioralSignal,
    DigestItem,
    ProactiveSurfacingEvent,
    SignalType,
    UserProfile,
)
from briefly_api.services import behavioral_fingerprint as fp_service

log = logging.getLogger(__name__)

# High-intent signal types that trigger immediate profile update
_HIGH_INTENT = {SignalType.followed_up, SignalType.saved, SignalType.acted, SignalType.decision_changed}

# Signal weight for immediate cluster reinforcement (different from LearningAgent's)
_IMMEDIATE_DELTA = {
    SignalType.followed_up:       +0.06,
    SignalType.saved:             +0.05,
    SignalType.clicked:           +0.02,
    SignalType.acted:             +0.08,
    SignalType.decision_changed:  +0.10,
    SignalType.tracked:           +0.04,
    SignalType.disliked:          -0.08,
    SignalType.dismissed:         -0.04,
}

# If a user has followed up N+ times on one topic in a session → proactive alert
_FOLLOW_UP_TRIGGER = 3


async def process_signal(
    session,
    user_id: str,
    signal_type: SignalType,
    digest_item_id: str | None,
    meta: dict | None = None,
) -> None:
    """
    Process a single behavioral signal immediately.
    Called from the API route after the signal is saved to DB.
    """
    s = get_settings()
    if not s.signal_monitor_enabled:
        return

    if signal_type not in _IMMEDIATE_DELTA:
        return

    # ── Load the digest item that triggered the signal ────────────────────────
    if not digest_item_id:
        return

    item_result = await session.execute(
        select(DigestItem).where(DigestItem.id == digest_item_id)
    )
    item = item_result.scalar_one_or_none()
    if not item:
        return

    item_text = " ".join(filter(None, [item.headline, item.why_it_matters])).lower()

    # ── Immediate topic cluster reinforcement ─────────────────────────────────
    profile_result = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        return

    delta = _IMMEDIATE_DELTA[signal_type]
    clusters = list(profile.topic_clusters or [])
    modified = False

    from briefly_api.services.profile_utils import cluster_label
    for cluster in clusters:
        label = cluster_label(cluster)
        if not label:
            continue
        label_words = {w for w in label.lower().split() if len(w) > 3}
        if label_words and any(w in item_text for w in label_words):
            old = float(cluster.get("strength", 0.3))
            cluster["strength"] = round(min(1.0, max(0.0, old + delta)), 4)
            modified = True

    if modified:
        profile.topic_clusters = clusters
        flag_modified(profile, "topic_clusters")
        await session.flush()

    # ── Trigger fingerprint rebuild on high-intent signals ────────────────────
    if signal_type in _HIGH_INTENT:
        # Count how many high-intent signals the user has had in the last 6 hours
        cutoff = datetime.now(timezone.utc) - timedelta(
            hours=s.behavioral_fingerprint_refresh_hours
        )
        recent_result = await session.execute(
            select(BehavioralSignal).where(
                BehavioralSignal.user_id == user_id,
                BehavioralSignal.signal_type.in_(list(_HIGH_INTENT)),
                BehavioralSignal.created_at >= cutoff,
            ).limit(20)
        )
        recent_high = recent_result.scalars().all()

        # Rebuild if we have ≥ 3 new high-intent signals since last build
        if len(recent_high) >= 3:
            try:
                await fp_service.build_and_save(session, user_id)
            except Exception:
                log.debug("SignalMonitorAgent: fingerprint rebuild failed", exc_info=True)

    # ── Detect follow-up depth threshold for proactive surfacing ─────────────
    if signal_type == SignalType.followed_up:
        await _check_follow_up_surfacing(session, user_id, item, meta)


async def _check_follow_up_surfacing(
    session, user_id: str, item: DigestItem, meta: dict | None
) -> None:
    """
    If a user has followed up N+ times on the same topic in one session,
    queue a proactive surfacing event.
    """
    # Count follow-ups on items with overlapping keywords in last 24h
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    result = await session.execute(
        select(BehavioralSignal).where(
            BehavioralSignal.user_id == user_id,
            BehavioralSignal.signal_type == SignalType.followed_up,
            BehavioralSignal.created_at >= cutoff,
        ).limit(20)
    )
    recent_followups = result.scalars().all()

    if len(recent_followups) < _FOLLOW_UP_TRIGGER:
        return

    # Check if we've already created a surfacing event for this item recently
    existing_result = await session.execute(
        select(ProactiveSurfacingEvent).where(
            ProactiveSurfacingEvent.user_id == user_id,
            ProactiveSurfacingEvent.event_type == "voice_note_connection",
            ProactiveSurfacingEvent.created_at >= cutoff,
        ).limit(1)
    )
    if existing_result.scalar_one_or_none():
        return

    # Create a proactive surfacing event
    topic = (item.headline or "")[:80]
    surfacing = ProactiveSurfacingEvent(
        user_id=user_id,
        event_type="voice_note_connection",
        title=f"You've been deep-diving on: {topic}",
        body=(
            f"You've asked {len(recent_followups)} follow-up questions today. "
            f"I'll look for more on this topic for your next briefing."
        ),
        content_ids=[item.id] if item.id else [],
        priority=6,
    )
    session.add(surfacing)
    await session.flush()

    log.info(
        "SignalMonitorAgent: proactive follow-up event queued for user %s on '%s'",
        user_id, topic[:50],
    )
