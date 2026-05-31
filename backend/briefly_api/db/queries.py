"""
briefly_api/db/queries.py

Pre-built async query helpers used by the pipeline and API routes.
All functions take an open AsyncSession and return plain Python objects
(not ORM instances) so they can safely cross async context boundaries.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.db.models import (
    Digest, DigestItem, Source, SourceStatus,
    User, UserMemory, UserProfile,
)


async def get_user_with_profile(session: AsyncSession, user_id: str) -> dict | None:
    """Return user + profile as a merged dict, or None if not found."""
    result = await session.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user_id, User.is_active == True)
    )
    user = result.scalar_one_or_none()
    if not user:
        return None

    data: dict = {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "profile": {},
    }

    if user.profile:
        p = user.profile
        data["profile"] = {
            "role": p.role,
            "goal": p.goal,
            "expertise_level": p.expertise_level,
            "recent_insight": p.recent_insight,
            "changed_mind_about": p.changed_mind_about,
            "interests": p.interests or [],
            "never_show": p.never_show or [],
            "topic_clusters": p.topic_clusters or [],
            "digest_time": p.digest_time,
            "digest_timezone": p.digest_timezone,
            "digest_length": p.digest_length,
            "digest_format": p.digest_format,
            "profile_embedding": list(p.profile_embedding) if p.profile_embedding is not None else None,
            "avg_open_rate": p.avg_open_rate,
            "avg_click_rate": p.avg_click_rate,
            "total_digests_received": p.total_digests_received,
            "suggested_sources": p.suggested_sources or [],
            "source_weights": {},  # populated by LearningAgent over time
        }

    return data


async def get_active_sources(session: AsyncSession, user_id: str) -> list[Source]:
    """Return all active Source ORM objects for a user."""
    result = await session.execute(
        select(Source).where(
            Source.user_id == user_id,
            Source.status == SourceStatus.active,
        )
    )
    return list(result.scalars().all())


async def get_recent_digest_items(
    session: AsyncSession, user_id: str, days: int = 7
) -> list[dict]:
    """Return digest items from the last N days as plain dicts."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = await session.execute(
        select(DigestItem, Digest.digest_date)
        .join(Digest, DigestItem.digest_id == Digest.id)
        .where(
            Digest.user_id == user_id,
            Digest.created_at >= cutoff,
        )
        .order_by(Digest.created_at.desc())
        .limit(50)
    )
    rows = result.all()
    return [
        {
            "digest_date": digest_date,
            "headline": item.headline,
            "summary": item.summary,
            "source_name": item.source_name,
            "source_url": item.source_url,
            "relevance_score": item.relevance_score,
        }
        for item, digest_date in rows
    ]


async def get_seen_content_hashes(
    session: AsyncSession, user_id: str, days: int = 30
) -> set[str]:
    """Return set of content hashes shown to user in last N days."""
    from briefly_api.db.models import RawContent
    from sqlalchemy import text as sa_text

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Join digest_items → raw_contents to get content hashes
    result = await session.execute(
        sa_text("""
            SELECT rc.content_hash
            FROM digest_items di
            JOIN digests d ON di.digest_id = d.id
            JOIN raw_contents rc ON di.content_id = rc.id
            WHERE d.user_id = :user_id
              AND d.created_at >= :cutoff
              AND rc.content_hash IS NOT NULL
        """),
        {"user_id": user_id, "cutoff": cutoff},
    )
    return {row[0] for row in result.fetchall()}


async def get_active_story_threads(
    session: AsyncSession, user_id: str
) -> list[dict]:
    """Return recent story threads the user has been tracking."""
    result = await session.execute(
        select(UserMemory).where(
            UserMemory.user_id == user_id,
            UserMemory.memory_type == "story_thread",
        )
        .order_by(UserMemory.last_seen_at.desc())
        .limit(20)
    )
    memories = result.scalars().all()
    return [
        {
            "key": m.key,
            "value": m.value,
            "strength": m.strength,
            "occurrence_count": m.occurrence_count,
            "last_seen_at": m.last_seen_at.isoformat() if m.last_seen_at else None,
        }
        for m in memories
    ]
