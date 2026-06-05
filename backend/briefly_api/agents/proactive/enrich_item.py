"""
briefly_api/agents/proactive/enrich_item.py

Fast single-item enrichment for browser capture feedback.
Runs ConnectionSkill + RelevanceSkill (skips ContradictionSkill for speed).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from briefly_api.agents.proactive.context_builder import _build_profile_summary
from briefly_api.agents.skills.connection_skill import ConnectionSkill
from briefly_api.agents.skills.relevance_skill import RelevanceSkill
from briefly_api.db.models import (
    ContentEnrichmentCache,
    Digest,
    DigestItem,
    RawContent,
    UserMemory,
    UserProfile,
)

log = logging.getLogger(__name__)


async def enrich_content_item(
    session,
    user_id: str,
    content_id: str,
    *,
    user_note: str | None = None,
    force: bool = False,
) -> ContentEnrichmentCache:
    """
    Enrich one RawContent row and persist to ContentEnrichmentCache.
    Returns the cache row (existing or newly created).
    """
    existing = await session.execute(
        select(ContentEnrichmentCache).where(
            ContentEnrichmentCache.content_id == content_id,
            ContentEnrichmentCache.user_id == user_id,
        )
    )
    cached = existing.scalar_one_or_none()
    if cached and not force:
        return cached
    if cached and force:
        await session.delete(cached)
        await session.flush()

    item_result = await session.execute(
        select(RawContent).where(
            RawContent.id == content_id,
            RawContent.user_id == user_id,
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        raise ValueError("Content item not found.")

    profile_result = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = profile_result.scalar_one_or_none()
    profile_summary = _build_profile_summary(profile) if profile else "No profile available."

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

    cutoff_14d = datetime.now(timezone.utc) - timedelta(days=14)
    recent_result = await session.execute(
        select(DigestItem.headline)
        .join(Digest, DigestItem.digest_id == Digest.id)
        .where(
            Digest.user_id == user_id,
            Digest.created_at >= cutoff_14d,
        )
        .order_by(Digest.created_at.desc())
        .limit(50)
    )
    recent_headlines = [r[0] for r in recent_result.all() if r[0]]

    item_title = item.title or ""
    item_summary = (item.summary or item.clean_text or "")[:400]
    if user_note:
        item_summary = f"{item_summary}\n\nUser note: {user_note[:500]}"

    conn_result = await ConnectionSkill().run(
        item_title=item_title,
        item_summary=item_summary,
        story_threads=threads,
        recent_items=recent_headlines,
    )
    why_relevant = await RelevanceSkill().run(
        item_title=item_title,
        item_summary=item_summary,
        profile_summary=profile_summary,
    )

    cache_row = ContentEnrichmentCache(
        content_id=item.id,
        user_id=user_id,
        why_relevant=why_relevant or None,
        memory_connections=[],
        thread_update=conn_result.thread_update,
        thread_key=conn_result.thread_key,
        connection_strength=conn_result.connection_strength,
        connection_sentence=conn_result.connection_sentence,
    )
    session.add(cache_row)
    await session.flush()
    log.info("Enriched single item %s for user %s", content_id, user_id)
    return cache_row


async def count_thread_captures_this_week(
    session,
    user_id: str,
    thread_key: str | None,
) -> int:
    """Count browser captures linked to a thread in the last 7 days."""
    if not thread_key:
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    result = await session.execute(
        select(func.count())
        .select_from(ContentEnrichmentCache)
        .join(RawContent, RawContent.id == ContentEnrichmentCache.content_id)
        .where(
            ContentEnrichmentCache.user_id == user_id,
            ContentEnrichmentCache.thread_key == thread_key,
            RawContent.ingested_at >= cutoff,
        )
    )
    return int(result.scalar_one() or 0)
