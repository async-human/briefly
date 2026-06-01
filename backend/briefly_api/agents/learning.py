"""
briefly_api/agents/learning.py

LearningAgent — updates user profile after every digest.

Two responsibilities:
  1. Counters & cluster weights  (lightweight, always runs)
  2. Evolve the Personal Relevance Vector  (async embed call)
     Looks at which digest items the user clicked / saved / followed-up
     in the past 14 days, embeds the aggregate signal text, and blends
     it into the stored profile_embedding using an exponential moving
     average (α = 0.15).  Result: the vector silently drifts toward the
     user's real interests over time with zero user effort.

Runs after delivery; failures never block the digest from being sent.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from briefly_api.agents.context import PipelineContext
from briefly_api.db.models import BehavioralSignal, DigestItem, SignalType, UserProfile
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.services.profile_utils import cluster_label

log = logging.getLogger(__name__)

# EMA blend weight for new behavioral signal (0 = ignore new; 1 = replace old)
_ALPHA = 0.15
# Lookback window for behavioral signals
_SIGNAL_WINDOW_DAYS = 14
# Max engaged items to use as signal (avoids over-weighting one noisy session)
_MAX_SIGNAL_ITEMS = 15


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

        # ── 2. Lightweight topic-cluster counter update ────────────────────────
        await _update_topic_clusters(ctx, session)

        await session.flush()

        # ── 3. Evolve the Personal Relevance Vector ───────────────────────────
        await _evolve_profile_embedding(ctx, session)

    except Exception as exc:
        log.exception("LearningAgent: failed to update profile: %s", exc)
        ctx.log_error("LearningAgent", str(exc))

    log.info("LearningAgent: updated profile for user %s", ctx.user.user_id)
    return ctx


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _update_topic_clusters(ctx: PipelineContext, session) -> None:
    """
    Increment item_count for digest sections seen today.
    Persists to UserProfile.topic_clusters (skips meta rows).
    """
    section_counts: dict[str, int] = {}
    for item in ctx.digest_items:
        section = (item.section or "General").strip()
        if section:
            section_counts[section] = section_counts.get(section, 0) + 1

    if not section_counts:
        return

    result = await session.execute(
        select(UserProfile).where(UserProfile.user_id == ctx.user.user_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return

    clusters = list(profile.topic_clusters or [])
    meta_rows = [c for c in clusters if c.get("_type") in {"source_weight", "meta"}]
    real_clusters = [c for c in clusters if cluster_label(c)]

    by_label: dict[str, dict] = {}
    for entry in real_clusters:
        label = cluster_label(entry)
        if label:
            by_label[label.lower()] = dict(entry)

    for section, count in section_counts.items():
        key = section.lower()
        if key in by_label:
            by_label[key]["item_count"] = by_label[key].get("item_count", 0) + count
            by_label[key]["section"] = section
        else:
            by_label[key] = {
                "cluster": section,
                "section": section,
                "item_count": count,
                "strength": 0.3,
            }

    profile.topic_clusters = meta_rows + list(by_label.values())
    await session.flush()


async def _evolve_profile_embedding(ctx: PipelineContext, session) -> None:
    """
    Blend recently engaged-with content into the profile embedding.

    Signal sources (positive engagement signals only):
      - clicked      → user found the headline interesting enough to read
      - saved        → explicit "keep this" intent
      - followed_up  → strong enough interest to start a thread

    The blend uses an exponential moving average so the vector shifts
    gradually rather than jumping on a single data point.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=_SIGNAL_WINDOW_DAYS)

    # Join BehavioralSignal → DigestItem to get the actual content text
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
        log.debug("LearningAgent: no engagement signals for user %s — skipping embedding update", ctx.user.user_id)
        return

    # Build signal text from what the user actually engaged with
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

        old_emb: list[float] | None = ctx.user.profile.get("profile_embedding")

        if old_emb and len(old_emb) == len(signal_emb):
            # EMA blend: (1-α) * old + α * new
            blended = [
                (1.0 - _ALPHA) * o + _ALPHA * s
                for o, s in zip(old_emb, signal_emb)
            ]
            # L2-normalise so cosine similarity stays well-behaved
            magnitude = sum(x * x for x in blended) ** 0.5
            new_emb = [x / magnitude for x in blended] if magnitude > 0 else blended
        else:
            # No prior embedding (or dimension mismatch after model change) — replace
            new_emb = signal_emb

        await session.execute(
            update(UserProfile)
            .where(UserProfile.user_id == ctx.user.user_id)
            .values(profile_embedding=new_emb)
        )

        log.info(
            "LearningAgent: evolved profile embedding for user %s from %d signal(s) (α=%.2f)",
            ctx.user.user_id, len(rows), _ALPHA,
        )

    except Exception:
        log.exception("LearningAgent: embedding evolution failed for user %s", ctx.user.user_id)
