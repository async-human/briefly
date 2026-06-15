"""
briefly_api/services/source_recommendation.py

Recommends new sources to a user using three complementary signals, then
blends them into one ranked list:

  1. Content similarity ("similar")
     Embed each candidate source's name/topic and rank it against the user's
     *taste vector* — the engagement-weighted centroid of the content their
     current sources actually produce. Answers "more sources like the ones
     you read."

  2. Collaborative filtering ("readers_like_you")
     Find users whose source set overlaps with this user's, then surface the
     sources those neighbours have that this user doesn't. This is the signal
     that gets better as the user base grows — a network-effects moat that
     pure content matching can't replicate. Privacy: a source is only ever
     recommended when it appears across at least `min_neighbors` distinct
     neighbours, so we never expose any single other user's unique source.

  3. Interest discovery ("interest")
     The existing keyword → Google News / Medium / Reddit / YouTube search
     candidates, used as a cold-start fallback and to widen the pool.

All reads are over existing tables — no schema changes required here.
"""
from __future__ import annotations

import logging
import math
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings
from briefly_api.db.models import (
    ContentEmbedding,
    RawContent,
    Source,
    SourceStatus,
)
from briefly_api.embeddings.adapter import get_embedding_adapter

log = logging.getLogger(__name__)

# Only sources the user actually engages with shape the taste vector.
_ENGAGED_WEIGHT_FLOOR = 0.5
# Recent content per source averaged into its centroid.
_CENTROID_MAX_ITEMS = 40
# Collaborative privacy floor: a candidate must appear across this many
# distinct neighbours before it can be recommended.
_MIN_NEIGHBORS = 2
# How many of the closest neighbours to draw collaborative candidates from.
_MAX_NEIGHBORS = 25


# ── Vector helpers ──────────────────────────────────────────────────────────────

def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _mean(vectors: list[list[float]]) -> list[float] | None:
    if not vectors:
        return None
    dim = len(vectors[0])
    acc = [0.0] * dim
    n = 0
    for v in vectors:
        if len(v) != dim:
            continue
        for i, x in enumerate(v):
            acc[i] += x
        n += 1
    if n == 0:
        return None
    return [x / n for x in acc]


# ── Content-based similarity ─────────────────────────────────────────────────────

async def source_centroid(
    session: AsyncSession, source_id: str, *, max_items: int = _CENTROID_MAX_ITEMS
) -> list[float] | None:
    """Average of the most recent content embeddings produced by a source."""
    result = await session.execute(
        select(ContentEmbedding.embedding)
        .join(RawContent, ContentEmbedding.content_id == RawContent.id)
        .where(RawContent.source_id == source_id)
        .order_by(RawContent.ingested_at.desc())
        .limit(max_items)
    )
    vectors = [list(row[0]) for row in result.all() if row[0] is not None]
    return _mean(vectors)


async def user_taste_vector(
    session: AsyncSession, user_id: str, profile: dict
) -> list[float] | None:
    """
    Engagement-weighted centroid of the content the user's sources produce.
    Falls back to the stored profile embedding when no source content exists.
    """
    sources = (
        await session.execute(
            select(Source).where(
                Source.user_id == user_id,
                Source.status == SourceStatus.active,
            )
        )
    ).scalars().all()

    weights: dict = profile.get("source_weights") or {}
    accum: list[float] | None = None
    total = 0.0
    for src in sources:
        weight = float(
            weights.get(str(src.id))
            if weights.get(str(src.id)) is not None
            else weights.get((src.name or "").lower(), 0.5)
        )
        if weight < _ENGAGED_WEIGHT_FLOOR:
            continue
        centroid = await source_centroid(session, src.id)
        if not centroid:
            continue
        if accum is None:
            accum = [v * weight for v in centroid]
        elif len(centroid) == len(accum):
            accum = [a + v * weight for a, v in zip(accum, centroid)]
        else:
            continue
        total += weight

    if accum is not None and total > 0:
        return [v / total for v in accum]

    profile_embedding = profile.get("profile_embedding")
    return list(profile_embedding) if profile_embedding else None


def _candidate_text(candidate: dict) -> str:
    parts = [
        candidate.get("name") or "",
        candidate.get("topic") or "",
        candidate.get("description") or candidate.get("reason") or "",
    ]
    return " | ".join(p for p in parts if p) or (candidate.get("url") or "")


async def attach_content_similarity(
    candidates: list[dict],
    taste_vector: list[float] | None,
    settings: Settings,
) -> list[dict]:
    """Embed each candidate's text and score cosine similarity to the taste vector."""
    if not candidates or not taste_vector:
        for c in candidates:
            c.setdefault("similarity", 0.0)
        return candidates

    embedder = get_embedding_adapter(settings)
    try:
        vectors = await embedder.embed_batch([_candidate_text(c) for c in candidates])
    except Exception as exc:
        log.warning("Source recommendation: candidate embedding failed: %s", exc)
        for c in candidates:
            c.setdefault("similarity", 0.0)
        return candidates

    for candidate, vec in zip(candidates, vectors):
        candidate["similarity"] = round(max(0.0, _cosine(taste_vector, vec)), 4)
    return candidates


# ── Collaborative filtering ──────────────────────────────────────────────────────

async def collaborative_recommendations(
    session: AsyncSession,
    user_id: str,
    *,
    limit: int = 10,
    min_neighbors: int = _MIN_NEIGHBORS,
) -> list[dict]:
    """
    "Readers like you also follow…" — based purely on source-subscription
    overlap, never on content. Only returns sources shared by at least
    `min_neighbors` distinct neighbours (k-anonymity).
    """
    mine = (
        await session.execute(select(Source).where(Source.user_id == user_id))
    ).scalars().all()
    if not mine:
        return []

    my_keys = {(s.source_type, (s.identifier or "").lower()) for s in mine}
    my_identifiers = [s.identifier for s in mine if s.identifier]
    if not my_identifiers:
        return []

    # Neighbours: other users who share at least one identifier with us.
    shared_rows = (
        await session.execute(
            select(Source.user_id, Source.source_type, Source.identifier)
            .where(
                Source.identifier.in_(my_identifiers),
                Source.user_id != user_id,
            )
        )
    ).all()

    overlap: dict[str, int] = defaultdict(int)
    for nuid, stype, ident in shared_rows:
        if (stype, (ident or "").lower()) in my_keys:
            overlap[nuid] += 1
    if not overlap:
        return []

    neighbours = sorted(overlap.items(), key=lambda kv: kv[1], reverse=True)[:_MAX_NEIGHBORS]
    neighbour_ids = [nid for nid, _ in neighbours]
    overlap_by_neighbour = dict(neighbours)

    # Candidate sources = what neighbours follow that we don't.
    neighbour_sources = (
        await session.execute(
            select(Source).where(
                Source.user_id.in_(neighbour_ids),
                Source.status == SourceStatus.active,
            )
        )
    ).scalars().all()

    # Aggregate per (type, identifier): score by neighbour overlap, count distinct neighbours.
    agg: dict[tuple[str, str], dict] = {}
    for src in neighbour_sources:
        key = (src.source_type, (src.identifier or "").lower())
        if key in my_keys or not src.identifier:
            continue
        entry = agg.setdefault(
            key,
            {
                "source_type": src.source_type,
                "identifier": src.identifier,
                "name": src.name or src.identifier,
                "neighbours": set(),
                "score": 0.0,
            },
        )
        entry["neighbours"].add(src.user_id)
        entry["score"] += float(overlap_by_neighbour.get(src.user_id, 1))

    results: list[dict] = []
    for entry in agg.values():
        n_neighbours = len(entry["neighbours"])
        if n_neighbours < min_neighbors:
            continue  # privacy / signal floor
        results.append(
            {
                "name": entry["name"],
                "url": entry["identifier"],
                "source_type": entry["source_type"],
                "topic": "",
                "description": f"Followed by {n_neighbours} readers with sources like yours",
                "reason": f"Followed by {n_neighbours} readers with sources like yours",
                "method": "readers_like_you",
                "collab_score": round(entry["score"], 3),
                "neighbours": n_neighbours,
            }
        )

    results.sort(key=lambda r: (r["neighbours"], r["collab_score"]), reverse=True)
    return results[:limit]


# ── Orchestration ────────────────────────────────────────────────────────────────

def _norm(values: list[float]) -> list[float]:
    if not values:
        return []
    hi = max(values)
    if hi <= 0:
        return [0.0] * len(values)
    return [v / hi for v in values]


async def recommend_sources(
    session: AsyncSession,
    user_id: str,
    settings: Settings,
    profile: dict,
    *,
    limit: int = 8,
    gmail_connected: bool = False,
    already_added: set[str] | None = None,
) -> list[dict]:
    """
    Unified, ranked source recommendations blending content similarity,
    collaborative filtering, and interest discovery.
    """
    from briefly_api.services.external_feed_discovery import (
        discover_interest_suggestions_light,
    )

    already_added = {a.lower() for a in (already_added or set())}

    # Gather candidates from interest discovery + collaborative filtering.
    interest_candidates: list[dict] = []
    try:
        interest_candidates = await discover_interest_suggestions_light(
            profile, settings, limit=limit + 6, gmail_connected=gmail_connected,
        )
        for c in interest_candidates:
            c["method"] = "interest"
    except Exception as exc:
        log.warning("Source recommendation: interest discovery failed: %s", exc)

    collab_candidates: list[dict] = []
    try:
        collab_candidates = await collaborative_recommendations(
            session, user_id, limit=limit + 4,
        )
    except Exception as exc:
        log.warning("Source recommendation: collaborative step failed: %s", exc)

    # Merge, de-duplicating by URL/identifier (collaborative wins on ties so its
    # richer "readers like you" reason survives).
    merged: dict[str, dict] = {}
    for cand in collab_candidates + interest_candidates:
        url = (cand.get("url") or "").lower()
        if not url or url in already_added or url in merged:
            continue
        merged[url] = cand
    candidates = list(merged.values())
    if not candidates:
        return []

    # Content-similarity rerank against the user's taste vector.
    taste = await user_taste_vector(session, user_id, profile)
    candidates = await attach_content_similarity(candidates, taste, settings)

    # Blend the three signals into one score.
    sims = _norm([c.get("similarity", 0.0) for c in candidates])
    collabs = _norm([float(c.get("collab_score", 0.0)) for c in candidates])
    for cand, sim_n, collab_n in zip(candidates, sims, collabs):
        base = 0.5 if cand.get("method") == "interest" else 0.4
        cand["score"] = round(0.45 * sim_n + 0.35 * collab_n + 0.20 * base, 4)
        # Promote the method label that actually drove the ranking.
        if collab_n >= 0.5 and cand.get("method") == "readers_like_you":
            pass
        elif sim_n >= 0.6:
            cand["method"] = "similar"
            if not cand.get("reason"):
                cand["reason"] = "Similar to sources you read most"

    candidates.sort(key=lambda c: c.get("score", 0.0), reverse=True)

    now = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).strftime("%Y-%m-%d")
    for cand in candidates:
        cand.setdefault("topic", "")
        cand.setdefault("description", cand.get("reason", ""))
        cand.setdefault("reason", cand.get("description", ""))
        cand.setdefault("discovered_at", now)
        cand.setdefault("similarity", 0.0)
    return candidates[:limit]
