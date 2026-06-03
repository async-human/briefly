"""
briefly_api/agents/learning.py

LearningAgent — updates user profile after every digest.

Three responsibilities:
  1. Topic cluster reinforcement & decay
     Every topic cluster has a `strength` float (0–1) that:
     - Rises when the user clicks/saves/follows-up on items in that topic (+0.08 to +0.12)
     - Falls when the user skips/dislikes items in that topic (-0.05 to -0.10)
     - Decays 5% per week with no reinforcement (so dead topics fade automatically)

  2. Source weight updating
     Sources where the user engages heavily get a higher weight in the
     relevance agent's scoring. Sources ignored for two weeks are deprioritised.

  3. Evolve the Personal Relevance Vector
     Looks at which digest items the user clicked / saved / followed-up in
     the past 14 days, embeds the aggregate signal text, and blends it into
     the stored profile_embedding using an exponential moving average (α=0.15).
     Regenerates the full embedding every 7 days from the current topic cluster state.

Runs after delivery; failures never block the digest from being sent.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import flag_modified

from briefly_api.agents.context import PipelineContext
from briefly_api.db.models import (
    BehavioralSignal, Digest, DigestItem, SignalType, UserMemory, UserProfile,
)
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.services.profile_utils import cluster_label

log = logging.getLogger(__name__)

# EMA blend weight for new behavioral signal (0 = ignore new; 1 = replace old)
_ALPHA = 0.15
# Lookback window for behavioral signals
_SIGNAL_WINDOW_DAYS = 14
# Max engaged items to use as signal (avoids over-weighting one noisy session)
_MAX_SIGNAL_ITEMS = 15
# How often to force-regenerate profile embedding from full cluster state
_EMBEDDING_REFRESH_DAYS = 7
# Weekly decay rate for topic clusters with no reinforcement
_CLUSTER_DECAY_RATE = 0.05
# Weight delta per signal type
_SIGNAL_WEIGHT = {
    SignalType.clicked:     +0.08,
    SignalType.followed_up: +0.12,
    SignalType.saved:       +0.10,
    SignalType.skipped:     -0.05,
    SignalType.disliked:    -0.10,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _days_since(iso_str: str | None) -> float:
    if not iso_str:
        return 999.0
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() / 86400
    except Exception:
        return 999.0


async def run(ctx: PipelineContext) -> PipelineContext:
    """Update user profile with post-digest learning signals."""
    session = ctx.db_session
    if not session:
        log.warning("LearningAgent: no DB session — skipping")
        return ctx

    if not ctx.digest_items:
        return ctx

    try:
        # ── 1. Increment total digests received ───────────────────────────────
        await session.execute(
            update(UserProfile)
            .where(UserProfile.user_id == ctx.user.user_id)
            .values(total_digests_received=UserProfile.total_digests_received + 1)
        )

        # ── 2. Strength-based topic cluster update (decay + reinforce) ────────
        await _update_topic_clusters(ctx, session)

        # ── 3. Source weight update from recent engagement ────────────────────
        await _update_source_weights(ctx, session)

        await session.flush()

        # ── 4. Evolve the Personal Relevance Vector ───────────────────────────
        await _evolve_profile_embedding(ctx, session)

    except Exception as exc:
        log.exception("LearningAgent: failed to update profile: %s", exc)
        ctx.log_error("LearningAgent", str(exc))

    log.info("LearningAgent: updated profile for user %s", ctx.user.user_id)
    return ctx


# ── Topic cluster reinforcement & decay ───────────────────────────────────────

async def _update_topic_clusters(ctx: PipelineContext, session) -> None:
    """
    Reinforce topic clusters from behavioral signals (clicked/saved/followed_up/skipped/disliked)
    and apply weekly decay to clusters that haven't been reinforced.

    Topic matching: checks whether the item's headline + why_it_matters text
    contains keywords from each cluster label. This is intentionally simple —
    it catches the obvious matches without over-engineering topic extraction.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=_SIGNAL_WINDOW_DAYS)

    # Fetch recent signals joined with their digest item text
    result = await session.execute(
        select(
            BehavioralSignal.signal_type,
            DigestItem.headline,
            DigestItem.why_it_matters,
            DigestItem.section,
            DigestItem.source_name,
        )
        .join(DigestItem, BehavioralSignal.digest_item_id == DigestItem.id)
        .where(
            BehavioralSignal.user_id == ctx.user.user_id,
            BehavioralSignal.signal_type.in_(list(_SIGNAL_WEIGHT.keys())),
            BehavioralSignal.created_at >= cutoff,
        )
        .limit(50)
    )
    signals = result.all()

    result2 = await session.execute(
        select(UserProfile).where(UserProfile.user_id == ctx.user.user_id)
    )
    profile = result2.scalar_one_or_none()
    if not profile:
        return

    clusters: dict[str, dict] = {}
    for entry in (profile.topic_clusters or []):
        label = cluster_label(entry)
        if label:
            clusters[label.lower()] = dict(entry)

    # Also seed clusters from declared interests if not present
    for interest in (profile.interests or []):
        topic = (interest.get("topic") or "").strip().lower()
        if topic and topic not in clusters:
            clusters[topic] = {
                "cluster": interest.get("topic") or topic,
                "strength": float(interest.get("weight", 0.5)),
                "first_seen": _now_iso(),
                "last_reinforced_at": _now_iso(),
                "item_count": 0,
                "source": "declared",
            }

    # Apply signal reinforcement
    for sig_row in signals:
        sig_type = sig_row.signal_type
        delta = _SIGNAL_WEIGHT.get(sig_type, 0.0)
        if delta == 0.0:
            continue

        item_text = " ".join(filter(None, [
            sig_row.headline,
            sig_row.why_it_matters,
            # section is an internal routing label ("What's new"), not a topic —
            # including it would reinforce those labels as fake interest clusters.
            sig_row.source_name,
        ])).lower()

        for label_key, cluster in clusters.items():
            # Match: any word from the label appears in the item text (words > 3 chars)
            label_words = {w for w in label_key.split() if len(w) > 3}
            if not label_words:
                continue
            if any(w in item_text for w in label_words):
                old_strength = float(cluster.get("strength", 0.3))
                cluster["strength"] = round(min(1.0, max(0.0, old_strength + delta)), 4)
                cluster["last_reinforced_at"] = _now_iso()
                cluster["item_count"] = cluster.get("item_count", 0) + 1

        # Also create new clusters from positive signals if a match exists in declared interests
        if delta > 0:
            for interest in (profile.interests or []):
                topic = (interest.get("topic") or "").strip()
                topic_lower = topic.lower()
                if topic_lower and topic_lower not in clusters:
                    topic_words = {w for w in topic_lower.split() if len(w) > 3}
                    if topic_words and any(w in item_text for w in topic_words):
                        clusters[topic_lower] = {
                            "cluster": topic,
                            "strength": round(0.4 + delta, 4),
                            "first_seen": _now_iso(),
                            "last_reinforced_at": _now_iso(),
                            "item_count": 1,
                            "source": "inferred",
                        }

    # Apply weekly decay to all clusters
    for cluster in clusters.values():
        days = _days_since(cluster.get("last_reinforced_at"))
        if days > 7:
            weeks_elapsed = days / 7.0
            decay = (1.0 - _CLUSTER_DECAY_RATE) ** weeks_elapsed
            cluster["strength"] = round(max(0.0, float(cluster.get("strength", 0.3)) * decay), 4)

    # Sort by strength descending, keep top 30
    sorted_clusters = sorted(clusters.values(), key=lambda x: x.get("strength", 0), reverse=True)[:30]

    # Preserve meta rows (source_weight, meta type)
    meta_rows = [c for c in (profile.topic_clusters or []) if c.get("_type") in {"source_weight", "meta"}]
    profile.topic_clusters = meta_rows + sorted_clusters
    # SQLAlchemy doesn't reliably detect mutations on JSONB columns without this.
    flag_modified(profile, "topic_clusters")
    await session.flush()


# ── Source weight updating ────────────────────────────────────────────────────

async def _update_source_weights(ctx: PipelineContext, session) -> None:
    """
    Update source_weights in UserProfile based on recent engagement.
    Sources with high click-through rate get boosted; ignored sources fade.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)

    # Count signals per source_name in recent digests
    result = await session.execute(
        select(
            DigestItem.source_name,
            BehavioralSignal.signal_type,
        )
        .join(DigestItem, BehavioralSignal.digest_item_id == DigestItem.id)
        .where(
            BehavioralSignal.user_id == ctx.user.user_id,
            BehavioralSignal.signal_type.in_([
                SignalType.clicked, SignalType.saved,
                SignalType.followed_up, SignalType.skipped,
                SignalType.disliked,
            ]),
            BehavioralSignal.created_at >= cutoff,
        )
        .limit(200)
    )
    rows = result.all()

    # Tally engagement per source
    source_pos: dict[str, int] = {}
    source_neg: dict[str, int] = {}
    for source_name, sig_type in rows:
        if not source_name:
            continue
        key = source_name.lower()
        if sig_type in (SignalType.clicked, SignalType.saved, SignalType.followed_up):
            source_pos[key] = source_pos.get(key, 0) + 1
        else:
            source_neg[key] = source_neg.get(key, 0) + 1

    if not source_pos and not source_neg:
        return

    result2 = await session.execute(
        select(UserProfile).where(UserProfile.user_id == ctx.user.user_id)
    )
    profile = result2.scalar_one_or_none()
    if not profile:
        return

    weights: dict = dict(profile.source_weights or {})

    all_sources = set(source_pos) | set(source_neg)
    for key in all_sources:
        pos = source_pos.get(key, 0)
        neg = source_neg.get(key, 0)
        total = pos + neg
        if total == 0:
            continue
        engagement_ratio = pos / total
        # Blend toward the engagement ratio
        current = float(weights.get(key, 0.5))
        # Shift by 0.05 in the direction of the engagement ratio
        target = max(0.1, min(1.0, engagement_ratio))
        weights[key] = round(current + 0.05 * (target - current), 3)

    profile.source_weights = weights
    flag_modified(profile, "source_weights")
    await session.flush()


# ── Personal Relevance Vector evolution ───────────────────────────────────────

async def _evolve_profile_embedding(ctx: PipelineContext, session) -> None:
    """
    Blend recently engaged-with content into the profile embedding.

    Two paths:
    - Full regeneration (every 7 days): rebuild embedding from the full topic
      cluster state so the vector reflects who the user is NOW, not at onboarding.
    - Incremental EMA (otherwise): blend behavioral signal text into the existing
      embedding so the vector silently drifts toward the user's real interests.
    """
    result = await session.execute(
        select(UserProfile).where(UserProfile.user_id == ctx.user.user_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return

    days_since_update = _days_since(
        profile.profile_embedding_updated_at.isoformat()
        if profile.profile_embedding_updated_at else None
    )
    needs_full_regen = days_since_update >= _EMBEDDING_REFRESH_DAYS

    if needs_full_regen:
        await _regenerate_embedding_from_clusters(profile, session)
    else:
        await _blend_behavioral_signals(ctx, profile, session)


async def _regenerate_embedding_from_clusters(profile, session) -> None:
    """Build a fresh profile embedding from the current topic cluster state."""
    clusters = [c for c in (profile.topic_clusters or []) if cluster_label(c)]
    interests = profile.interests or []

    if not clusters and not interests:
        return

    # Build rich text representation of user's current interest profile
    parts: list[str] = []
    if profile.role:
        parts.append(f"Role: {profile.role}")
    if profile.goal:
        parts.append(f"Goal: {profile.goal}")

    # Top interests by strength
    for c in sorted(clusters, key=lambda x: x.get("strength", 0), reverse=True)[:10]:
        label = cluster_label(c)
        if label:
            parts.append(label)

    for interest in interests[:8]:
        topic = (interest.get("topic") or "").strip()
        if topic:
            parts.append(topic)

    text = " | ".join(parts)
    if not text.strip():
        return

    try:
        embedder = get_embedding_adapter()
        new_emb = await embedder.embed(text)

        await session.execute(
            update(UserProfile)
            .where(UserProfile.id == profile.id)
            .values(
                profile_embedding=new_emb,
                profile_embedding_updated_at=datetime.now(timezone.utc),
            )
        )
        log.info(
            "LearningAgent: regenerated profile embedding for user %s from %d clusters",
            profile.user_id, len(clusters),
        )
    except Exception:
        log.exception("LearningAgent: embedding regeneration failed for user %s", profile.user_id)


async def _blend_behavioral_signals(ctx: PipelineContext, profile, session) -> None:
    """EMA-blend recent engagement signals into the existing profile embedding."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=_SIGNAL_WINDOW_DAYS)

    result = await session.execute(
        select(DigestItem.headline, DigestItem.why_it_matters)
        .join(BehavioralSignal, BehavioralSignal.digest_item_id == DigestItem.id)
        .where(
            BehavioralSignal.user_id == ctx.user.user_id,
            BehavioralSignal.signal_type.in_([
                SignalType.clicked,
                SignalType.saved,
                SignalType.followed_up,
            ]),
            BehavioralSignal.created_at >= cutoff,
        )
        .distinct()
        .limit(_MAX_SIGNAL_ITEMS)
    )
    rows = result.all()

    if not rows:
        return

    signal_text = " | ".join(
        f"{r.headline} {r.why_it_matters}"
        for r in rows
        if r.headline
    )
    if not signal_text.strip():
        return

    try:
        embedder = get_embedding_adapter()
        signal_emb = await embedder.embed(signal_text)

        old_emb: list[float] | None = (
            list(profile.profile_embedding) if profile.profile_embedding is not None else None
        )

        if old_emb and len(old_emb) == len(signal_emb):
            blended = [
                (1.0 - _ALPHA) * o + _ALPHA * s
                for o, s in zip(old_emb, signal_emb)
            ]
            magnitude = sum(x * x for x in blended) ** 0.5
            new_emb = [x / magnitude for x in blended] if magnitude > 0 else blended
        else:
            new_emb = signal_emb

        await session.execute(
            update(UserProfile)
            .where(UserProfile.id == profile.id)
            .values(profile_embedding=new_emb)
        )
        log.info(
            "LearningAgent: evolved profile embedding for user %s from %d signal(s) (α=%.2f)",
            profile.user_id, len(rows), _ALPHA,
        )
    except Exception:
        log.exception("LearningAgent: embedding evolution failed for user %s", profile.user_id)
