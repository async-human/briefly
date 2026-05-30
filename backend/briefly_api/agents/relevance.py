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

log = logging.getLogger(__name__)

# Dimension weights for final score
W_SEMANTIC   = 0.40   # embedding cosine similarity to user profile
W_TOPIC      = 0.30   # explicit topic keyword match
W_QUALITY    = 0.15   # content quality signals
W_RECENCY    = 0.10   # how fresh is this content
W_SOURCE     = 0.05   # historical user engagement with this source


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

    # Build interest keyword set for fast matching
    interest_keywords = _build_keyword_set(interests, topic_clusters)

    # Get profile embedding for semantic matching
    profile_embedding = profile.get("profile_embedding")
    embedder = get_embedding_adapter()

    # Generate profile embedding if missing
    if not profile_embedding:
        profile_text = _profile_to_text(profile, interests, topic_clusters)
        if profile_text:
            profile_embedding = await embedder.embed(profile_text)

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
        topic_score    = _topic_score(item, interest_keywords)
        quality_score  = _quality_score(item)
        recency_score  = _recency_score(item)
        source_score   = _source_score(item, ctx)

        # Weighted final score
        final = (
            W_SEMANTIC * semantic_score +
            W_TOPIC    * topic_score    +
            W_QUALITY  * quality_score  +
            W_RECENCY  * recency_score  +
            W_SOURCE   * source_score
        )
        final = round(min(1.0, max(0.0, final)), 4)
        item.relevance_score = final

        if final >= s.relevance_threshold:
            scored.append(item)
        else:
            item.drop_reason = "low_relevance"
            dropped.append(item)
            log.debug("Dropped (score=%.2f < %.2f): %s", final, s.relevance_threshold, item.title[:60])

    # Sort by relevance score descending
    scored.sort(key=lambda x: x.relevance_score, reverse=True)

    ctx.scored_items = scored
    ctx.dropped_items = dropped
    ctx.total_after_relevance = len(scored)

    log.info(
        "RelevanceAgent: %d items → %d scored, %d dropped (threshold=%.2f)",
        len(items), len(scored), len(dropped), s.relevance_threshold,
    )

    # Quality gate: if pool too small, relax threshold and retry
    if len(scored) < s.quality_gate_min_pool and dropped:
        log.info("Quality gate: pool too small (%d), relaxing threshold", len(scored))
        relaxed_threshold = s.relevance_threshold * 0.75
        rescued = [d for d in dropped if d.relevance_score >= relaxed_threshold]
        rescued.sort(key=lambda x: x.relevance_score, reverse=True)
        ctx.scored_items = scored + rescued
        log.info("Quality gate: rescued %d items with relaxed threshold %.2f", len(rescued), relaxed_threshold)

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
    # Cosine similarity is -1 to 1, map to 0-1
    return (similarity + 1) / 2


def _topic_score(item: RawItem, interest_keywords: set[str]) -> float:
    """
    Check how many of the user's interest keywords appear in the item.
    Simple but effective for explicit topic alignment.
    """
    if not interest_keywords:
        return 0.5

    text = f"{item.title} {item.summary} {item.clean_text[:1000]}".lower()
    matched = sum(1 for kw in interest_keywords if kw in text)
    if matched == 0:
        return 0.2
    # Diminishing returns: 1 match = 0.6, 3 matches = 0.85, 5+ = 1.0
    return min(1.0, 0.4 + (0.12 * matched))


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
    Weight based on user's historical engagement with this source.
    Falls back to neutral 0.5 if no signal data.
    This is updated by the LearningAgent over time.
    """
    # Source engagement weights live in user profile
    source_weights: dict = ctx.user.profile.get("source_weights", {})
    weight = source_weights.get(item.source_id, 0.5)
    return float(weight)


# ── Helper functions ──────────────────────────────────────────────────────────

def _build_keyword_set(
    interests: list[dict],
    topic_clusters: list[dict],
) -> set[str]:
    """Extract all interest keywords for fast text matching."""
    keywords: set[str] = set()

    for interest in interests:
        topic = interest.get("topic", "").lower()
        if topic:
            # Add the full topic and individual words
            keywords.add(topic)
            for word in topic.split():
                if len(word) > 3:
                    keywords.add(word)

    for cluster in topic_clusters:
        cluster_name = cluster.get("cluster", "").lower()
        if cluster_name:
            keywords.add(cluster_name)
            for word in cluster_name.split():
                if len(word) > 3:
                    keywords.add(word)

    return keywords


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
    """Hard block: return True if item matches any never-show filter."""
    if not never_show:
        return False
    text = f"{item.title} {item.source_name}".lower()
    return any(ns.lower() in text for ns in never_show)
