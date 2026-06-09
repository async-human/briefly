"""Profile interest signals for content filtering (Medium digests, etc.)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import UserProfile
from briefly_api.services.personalization_score import build_interest_model


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

    profile_dict = {
        "role": profile.role,
        "goal": profile.goal,
        "interests": list(profile.interests or []),
    }
    model = build_interest_model(profile_dict, list(profile.topic_clusters or []))
    keywords = set(model.phrases.keys())

    embedding = None
    if profile.profile_embedding is not None:
        embedding = list(profile.profile_embedding)

    return keywords, embedding
