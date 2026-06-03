"""Load user profile context for STT vocabulary hints."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.db.models import User
from briefly_api.stt.prompts import build_transcription_prompt


async def transcription_prompt_for_user(
    db: AsyncSession,
    user_id: str,
) -> str:
    result = await db.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    profile = user.profile if user else None
    if not profile:
        return build_transcription_prompt()

    interests = [
        i.get("topic", "")
        for i in (profile.interests or [])
        if isinstance(i, dict) and i.get("topic")
    ]
    return build_transcription_prompt(
        role=profile.role,
        interests=interests,
        topic_clusters=list(profile.topic_clusters or []),
    )
