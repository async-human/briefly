"""
briefly_api/agents/relevance.py

The RelevanceAgent is the heart of Briefly's personalization.
It scores every ingested item against the user's profile and decides
what gets shown vs quietly dropped.

This is what makes users feel "this understands me."

Scoring is multi-dimensional:
  1. Semantic similarity (embedding cosine) — does the content match interests?
  2. Topic keyword match — explicit interest alignment
  3. Never-show filter — hard block on excluded topics
  4. Source weight — user engagement history with this source
  5. Recency — fresher content scores slightly higher
  6. Quality — thin/low-quality content penalized

Final score: weighted combination. Items below threshold are dropped.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone

import numpy as np

from briefly_api.agents.context import PipelineContext, RawItem
from briefly_api.config import get_settings
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.services.personalization_score import (
    build_interest_model,
    deprioritized_penalty,
    topic_alignment_score,
)
from briefly_api.services.score_explain import build_score_breakdown

log = logging.getLogger(__name__)

# Dimension weights for final score
W_SEMANTIC   = 0.45   # embedding cosine similarity to user profile
W_TOPIC      = 0.28   # explicit interest / goal / cluster alignment
W_QUALITY    = 0.10   # content quality signals
W_RECENCY    = 0.08   # how fresh is this content
W_SOURCE     = 0.09   # engagement + starred source priority


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Score all deduplicated items for relevance to this user.
    Populates ctx.scored_items (above threshold) and ctx.dropped_items.
    """
    s = get_settings()
    items = ctx.deduplicated_items
    if not items:
        log.warning("RelevanceAgent: no items to score")
        return ctx

    profile = ctx.user.profile
    never_show: list[str] = profile.get("never_show", [])
    interests: list[dict] = profile.get("interests", [])
    topic_clusters: list[dict] = ctx.user.topic_clusters

    interest_model = build_interest_model(
        profile,
        topic_clusters,
        active_story_threads=ctx.user.active_story_threads,
    )

    # Get profile embedding for semantic matching
    profile_embedding = profile.get("profile_embedding")
    embedder = get_embedding_adapter()

    # Generate profile embedding if missing
    if not profile_embedding:
        profile_text = _profile_to_text(profile, interests, topic_clusters)
        if profile_text:
            profile_embedding = await embedder.embed(profile_text)

    # Pre-batch-embed any items whose embedding was not set by ContentCleanerAgent.
    # Without this, _semantic_score would make N sequential embed API calls (each
    # 300-800ms), turning a 1-call operation into minutes for large item sets.
    items_needing_embed = [i for i in items if not i.embedding]
    if items_needing_embed:
        try:
            texts = [
                f"{i.title} | {i.summary or i.clean_text[:400]}"
                for i in items_needing_embed
            ]
            batch_embeddings = await embedder.embed_batch(texts)
            for item, emb in zip(items_needing_embed, batch_embeddings):
                if emb:
                    item.embedding = emb
            log.info("RelevanceAgent: pre-embedded %d items missing embeddings", len(items_needing_embed))
        except Exception as exc:
            log.warning("RelevanceAgent: batch pre-embed failed, will embed per-item: %s", exc)

    threshold = s.relevance_threshold
    if ctx.force_refresh:
        threshold = max(0.48, threshold - 0.06)
    if len(items) < s.quality_gate_min_pool:
        threshold = max(0.45, threshold - 0.08)

    scored: list[RawItem] = []
    dropped: list[RawItem] = []

    for item in items:
        # Hard block: never-show filter
        if _matches_never_show(item, never_show):
            item.relevance_score = 0.0
            item.drop_reason = "never_show"
            dropped.append(item)
            log.debug("Dropped (never-show): %s", item.title[:60])
            continue

        # Score each dimension
        semantic_score = await _semantic_score(item, profile_embedding, embedder)
        topic_score    = topic_alignment_score(item, interest_model)
        quality_score  = _quality_score(item)
        recency_score  = _recency_score(item)
        source_score   = _source_score(item, ctx)
        thread_boost   = _story_thread_boost(item, ctx.user.active_story_threads)
        penalty        = deprioritized_penalty(item, interest_model)

        item.score_breakdown = build_score_breakdown(
            semantic=semantic_score,
            topic=topic_score,
            quality=quality_score,
            recency=recency_score,
            source=source_score,
            thread_boost=thread_boost,
            deprioritized_penalty=penalty,
            weights={
                "semantic": W_SEMANTIC,
                "topic": W_TOPIC,
                "quality": W_QUALITY,
                "recency": W_RECENCY,
                "source": W_SOURCE,
            },
        )

        # Weighted final score
        final = (
            W_SEMANTIC * semantic_score +
            W_TOPIC    * topic_score    +
            W_QUALITY  * quality_score  +
            W_RECENCY  * recency_score  +
            W_SOURCE   * source_score   +
            thread_boost
            - penalty
        )
        final = round(min(1.0, max(0.0, final)), 4)
        item.relevance_score = final

        if final < threshold:
            item.drop_reason = "low_relevance"
            dropped.append(item)
            log.debug("Dropped (low relevance %.2f): %s", final, item.title[:60])
            continue

        scored.append(item)

    # Manual refresh or thin scoring: never return an empty pool when content exists.
    if not scored and items:
        never_show_ids = {i.id for i in dropped if i.drop_reason == "never_show"}
        rescue_pool = [i for i in items if i.id not in never_show_ids]
        rescue_pool.sort(key=lambda x: x.relevance_score, reverse=True)
        floor = max(0.38, threshold - 0.17)
        rescued = [i for i in rescue_pool if i.relevance_score >= floor]
        if not rescued and rescue_pool:
            rescued = rescue_pool[: max(s.digest_min_items, 5)]
        if rescued:
            log.warning(
                "RelevanceAgent: rescue pass kept %d/%d items (floor=%.2f)",
                len(rescued),
                len(items),
                floor,
            )
            scored = rescued[: max(s.digest_min_items, 8)]
            rescued_ids = {i.id for i in scored}
            dropped = [i for i in dropped if i.id not in rescued_ids]

    scored.sort(key=lambda x: x.relevance_score, reverse=True)

    ctx.scored_items = scored
    ctx.dropped_items = dropped
    ctx.total_after_relevance = len(scored)

    if ctx.adjustments_to_confirm:
        from briefly_api.services.learned_adjustments import count_drop_for_adjustments

        ctx.adjustment_drop_counts = count_drop_for_adjustments(
            dropped, ctx.adjustments_to_confirm,
        )

    log.info(
        "RelevanceAgent: %d items passed, %d dropped (never-show=%d, low_relevance=%d)",
        len(scored),
        len(dropped),
        sum(1 for i in dropped if i.drop_reason == "never_show"),
        sum(1 for i in dropped if i.drop_reason == "low_relevance"),
    )

    return ctx


# ── Dimension scorers ─────────────────────────────────────────────────────────

async def _semantic_score(
    item: RawItem,
    profile_embedding: list[float] | None,
    embedder,
) -> float:
    """Cosine similarity between item embedding and user profile embedding."""
    if not profile_embedding:
        return 0.5  # neutral default when no profile embedding

    item_embedding = item.embedding
    if not item_embedding:
        # Generate on the fly if missing (should have been set by ContentCleanerAgent)
        try:
            text = f"{item.title} | {item.summary or item.clean_text[:500]}"
            item_embedding = await embedder.embed(text)
            item.embedding = item_embedding
        except Exception:
            return 0.5

    # Cosine similarity
    a = np.array(profile_embedding)
    b = np.array(item_embedding)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.5
    similarity = float(np.dot(a, b) / (norm_a * norm_b))
    # Cosine similarity is -1 to 1; map to 0-1 for weighted scoring.
    return max(0.0, min(1.0, (similarity + 1) / 2))


def _story_thread_boost(item: RawItem, active_story_threads: list[dict]) -> float:
    if not active_story_threads:
        return 0.0
    text = f"{item.title} {item.summary or ''}".lower()
    item_words = {w for w in text.split() if len(w) > 3}
    best = 0.0
    for thread in active_story_threads:
        key = str(thread.get("key") or "").lower()
        thread_words = {w for w in key.split() if len(w) > 3}
        overlap = len(thread_words & item_words)
        if overlap >= 2:
            strength = float(thread.get("strength") or 1.0)
            best = max(best, min(0.08, 0.03 + strength * 0.02))
    return best


def _quality_score(item: RawItem) -> float:
    """
    Penalize thin, low-quality content.
    Rewards: sufficient length, has a URL, has a title
    Penalizes: very short text, no URL, duplicate-heavy
    """
    score = 0.5

    text_len = len(item.clean_text or "")
    if text_len > 500:
        score += 0.2
    elif text_len > 200:
        score += 0.1
    elif text_len < 50:
        score -= 0.3

    if item.url:
        score += 0.1
    if item.title and len(item.title) > 10:
        score += 0.1
    if item.author:
        score += 0.05
    if item.published_at:
        score += 0.05

    return round(min(1.0, max(0.0, score)), 3)


def _recency_score(item: RawItem) -> float:
    """
    Fresher content scores higher. Decay over 72 hours.
    """
    if not item.published_at:
        return 0.5

    now = datetime.now(timezone.utc)
    published = item.published_at
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)

    hours_old = (now - published).total_seconds() / 3600

    if hours_old < 6:
        return 1.0
    elif hours_old < 24:
        return 0.85
    elif hours_old < 48:
        return 0.65
    elif hours_old < 72:
        return 0.45
    else:
        return 0.25


def _source_score(item: RawItem, ctx: PipelineContext) -> float:
    """
    Weight based on user's historical engagement with this source,
    explicit source priority (high/normal/low), and learned weights.
    """
    from briefly_api.services.source_priority import (
        PRIORITY_NORMAL,
        apply_priority_to_source_score,
        build_priority_map,
    )

    priority_map = build_priority_map(ctx.user.sources or [])
    source_weights: dict = ctx.user.profile.get("source_weights", {})

    # Prefer source_id key; fall back to source name for legacy weights
    weight = source_weights.get(item.source_id)
    if weight is None:
        weight = source_weights.get(item.source_name.lower(), 0.5)

    return apply_priority_to_source_score(float(weight), item.source_id, priority_map)


# ── Helper functions ──────────────────────────────────────────────────────────

def _profile_to_text(
    profile: dict,
    interests: list[dict],
    topic_clusters: list[dict],
) -> str:
    """Convert user profile to embeddable text."""
    parts = []
    if profile.get("role"):
        parts.append(f"role: {profile['role']}")
    if profile.get("goal"):
        parts.append(f"goal: {profile['goal']}")
    if interests:
        topics = " ".join(i.get("topic", "") for i in interests if i.get("topic"))
        parts.append(f"interests: {topics}")
    if topic_clusters:
        clusters = " ".join(c.get("cluster", "") for c in topic_clusters[:10])
        parts.append(f"topics: {clusters}")
    if profile.get("recent_insight"):
        parts.append(f"context: {profile['recent_insight'][:200]}")
    return " | ".join(p for p in parts if p)


def _matches_never_show(item: RawItem, never_show: list[str]) -> bool:
    """Hard block: return True if item matches any never-show filter.

    Checks title, source name, and summary so topics that only appear
    in the body are still caught, while avoiding expensive full-text scans.
    """
    if not never_show:
        return False
    text = f"{item.title} {item.source_name} {item.summary or ''}".lower()
    return any(ns.lower() in text for ns in never_show)
