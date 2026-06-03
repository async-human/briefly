"""
briefly_api/agents/proactive/context_builder.py

ContextBuilderAgent — builds rich context for each new content item.

This is the agent that moves the heavy thinking OUT of the morning pipeline.
It runs every 2 hours inside the enrichment worker and processes all
unenriched RawContent items for a user.

For each item it:
  1. Runs ConnectionSkill to find memory connections and story thread updates
  2. Runs ContradictionSkill (only when a similar recent item exists)
  3. Runs RelevanceSkill to pre-compute why_relevant and user_angle
  4. Saves results to ContentEnrichmentCache

By 07:00, when BriefingComposerAgent runs, 90% of the work is done.
The writer just assembles pre-computed insights into a coherent narrative.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from briefly_api.agents.skills.connection_skill import ConnectionSkill
from briefly_api.agents.skills.contradiction_skill import ContradictionSkill
from briefly_api.agents.skills.relevance_skill import RelevanceSkill
from briefly_api.config import get_settings
from briefly_api.db.models import (
    ContentEnrichmentCache,
    ContentEmbedding,
    Digest,
    DigestItem,
    RawContent,
    UserMemory,
    UserProfile,
)
from briefly_api.services.profile_utils import cluster_label

log = logging.getLogger(__name__)


async def run_for_user(session, user_id: str) -> dict:
    """
    Run ContextBuilderAgent for one user.
    Enriches up to `enrichment_max_items_per_run` new pool items.
    Returns a summary dict.
    """
    s = get_settings()
    if not s.enrichment_worker_enabled:
        return {"skipped": True}

    # ── Load user context ─────────────────────────────────────────────────────
    profile_result = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        return {"error": "profile not found"}

    profile_summary = _build_profile_summary(profile)

    # ── Load active story threads ─────────────────────────────────────────────
    threads_result = await session.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id,
            UserMemory.memory_type == "story_thread",
        )
    )
    threads = [
        {"key": t.key, "occurrence_count": t.occurrence_count, "value": t.value or {}}
        for t in threads_result.scalars().all()
    ]

    # ── Load recent digest headlines (for ConnectionSkill + ContradictionSkill)
    cutoff_14d = datetime.now(timezone.utc) - timedelta(days=14)
    recent_result = await session.execute(
        select(DigestItem.headline, DigestItem.summary, DigestItem.id)
        .join(Digest, DigestItem.digest_id == Digest.id)
        .where(
            Digest.user_id == user_id,
            Digest.created_at >= cutoff_14d,
        )
        .order_by(Digest.created_at.desc())
        .limit(50)
    )
    recent_rows = recent_result.all()
    recent_headlines = [r.headline for r in recent_rows if r.headline]
    recent_items_for_contradiction = [
        {"id": r.id, "headline": r.headline or "", "summary": r.summary or ""}
        for r in recent_rows
    ]

    # ── Find unenriched pool items ────────────────────────────────────────────
    enriched_ids_result = await session.execute(
        select(ContentEnrichmentCache.content_id).where(
            ContentEnrichmentCache.user_id == user_id
        )
    )
    enriched_ids = {row[0] for row in enriched_ids_result.all()}

    new_content_result = await session.execute(
        select(RawContent)
        .where(
            RawContent.user_id == user_id,
            RawContent.id.notin_(enriched_ids),
            RawContent.ingested_at >= datetime.now(timezone.utc) - timedelta(
                hours=s.pool_max_age_hours
            ),
        )
        .order_by(RawContent.ingested_at.desc())
        .limit(s.enrichment_max_items_per_run)
    )
    new_items = new_content_result.scalars().all()

    if not new_items:
        return {"enriched": 0}

    # ── Load embeddings for new items (for similarity-gated contradiction) ────
    item_ids = [i.id for i in new_items]
    emb_result = await session.execute(
        select(ContentEmbedding).where(ContentEmbedding.content_id.in_(item_ids))
    )
    embeddings_by_id = {e.content_id: list(e.embedding) for e in emb_result.scalars().all()}

    # ── Skills instantiation (reuse across items) ─────────────────────────────
    conn_skill  = ConnectionSkill()
    contr_skill = ContradictionSkill()
    rel_skill   = RelevanceSkill()

    enriched_count = 0

    for item in new_items:
        item_title   = item.title or ""
        item_summary = (item.summary or item.clean_text or "")[:400]

        # ── 1. ConnectionSkill ────────────────────────────────────────────────
        conn_result = await conn_skill.run(
            item_title=item_title,
            item_summary=item_summary,
            story_threads=threads,
            recent_items=recent_headlines,
        )

        # ── 2. ContradictionSkill (similarity-gated) ──────────────────────────
        contradiction_flag = False
        contradiction_explanation: str | None = None
        contradicts_item_id: str | None = None

        item_emb = embeddings_by_id.get(item.id)
        if item_emb:
            # Find most similar recent item
            best_sim = 0.0
            best_old = None
            for old in recent_items_for_contradiction:
                # Cosine similarity check would require loading old embeddings.
                # Approximate with keyword overlap (avoids extra DB queries here).
                item_words = set(item_title.lower().split())
                old_words  = set(old["headline"].lower().split())
                overlap    = len(item_words & old_words)
                overlap_ratio = overlap / max(len(item_words), 1)
                if overlap_ratio > best_sim:
                    best_sim = overlap_ratio
                    best_old = old

            if best_sim >= s.enrichment_contradiction_min_similarity and best_old:
                contr = await contr_skill.run(
                    new_title=item_title,
                    new_summary=item_summary,
                    old_title=best_old["headline"],
                    old_summary=best_old["summary"],
                )
                contradiction_flag        = contr.contradicts
                contradiction_explanation = contr.explanation
                contradicts_item_id       = best_old["id"] if contr.contradicts else None

        # ── 3. RelevanceSkill ─────────────────────────────────────────────────
        why_relevant = await rel_skill.run(
            item_title=item_title,
            item_summary=item_summary,
            profile_summary=profile_summary,
        )

        # ── 4. Save to ContentEnrichmentCache ─────────────────────────────────
        cache_row = ContentEnrichmentCache(
            content_id=item.id,
            user_id=user_id,
            why_relevant=why_relevant or None,
            memory_connections=[],  # thread match logic stays in MemoryAgent
            thread_update=conn_result.thread_update,
            thread_key=conn_result.thread_key,
            connection_strength=conn_result.connection_strength,
            contradiction_flag=contradiction_flag,
            contradiction_explanation=contradiction_explanation,
            contradicts_item_id=contradicts_item_id,
            connection_sentence=conn_result.connection_sentence,
        )
        session.add(cache_row)
        enriched_count += 1

    await session.flush()
    log.info(
        "ContextBuilderAgent: enriched %d/%d items for user %s",
        enriched_count, len(new_items), user_id,
    )
    return {"enriched": enriched_count}


def _build_profile_summary(profile: UserProfile) -> str:
    parts = []
    if profile.role:
        parts.append(f"Role: {profile.role}")
    if profile.goal:
        parts.append(f"Goal: {profile.goal}")
    interests = [
        (i.get("topic") or "").strip()
        for i in (profile.interests or [])
        if i.get("topic")
    ]
    if interests:
        parts.append(f"Interests: {', '.join(interests[:8])}")
    clusters = sorted(
        profile.topic_clusters or [],
        key=lambda c: c.get("strength", 0),
        reverse=True,
    )[:5]
    if clusters:
        labels = [cluster_label(c) for c in clusters if cluster_label(c)]
        if labels:
            parts.append(f"Top clusters: {', '.join(labels)}")
    return "\n".join(parts) if parts else "No profile available."
