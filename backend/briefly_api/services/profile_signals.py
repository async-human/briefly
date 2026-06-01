"""Profile interest signals for content filtering (Medium digests, etc.)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.agents.relevance import _build_keyword_set
from briefly_api.db.models import UserProfile


async def load_profile_signals(
    session: AsyncSession,
    user_id: str,
) -> tuple[set[str], list[float] | None]:
    """Return (interest_keywords, profile_embedding) for a user."""
    result = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return set(), None

    interests = list(profile.interests or [])
    clusters = list(profile.topic_clusters or [])
    keywords = _build_keyword_set(interests, clusters)

    for blob in (profile.role, profile.goal):
        if blob:
            for word in str(blob).lower().split():
                if len(word) > 3:
                    keywords.add(word)

    embedding = None
    if profile.profile_embedding is not None:
        embedding = list(profile.profile_embedding)

    return keywords, embedding
