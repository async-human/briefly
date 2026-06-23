"""Load user profile context for STT vocabulary hints."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.db.models import FollowUpThread, User
from briefly_api.services.orb_session import OrbSessionState
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


async def transcription_prompt_for_orb_turn(
    db: AsyncSession,
    user_id: str,
    *,
    session: OrbSessionState | None = None,
    thread_id: str | None = None,
) -> str:
    """STT hints for multi-turn orb — include recent conversation context."""
    base = await transcription_prompt_for_user(db, user_id)
    hints: list[str] = []

    if session and session.last_transcript:
        hints.append(f"Previous user utterance: {session.last_transcript[:240]}")

    resolved_thread = thread_id or (session.thread_id if session else None)
    if resolved_thread:
        result = await db.execute(
            select(FollowUpThread).where(
                FollowUpThread.id == resolved_thread,
                FollowUpThread.user_id == user_id,
            )
        )
        thread = result.scalar_one_or_none()
        if thread and thread.messages:
            for msg in reversed(thread.messages[-4:]):
                role = msg.get("role")
                content = str(msg.get("content") or "").strip()
                if not content:
                    continue
                if role == "assistant":
                    hints.append(f"Assistant just said: {content[:280]}")
                    break
            for msg in reversed(thread.messages[-6:]):
                role = msg.get("role")
                content = str(msg.get("content") or "").strip()
                if role == "user" and content:
                    hints.append(f"Earlier user question: {content[:200]}")
                    break

    if not hints:
        return base

    return (
        f"{base}\n\nConversation context (for accurate transcription of follow-ups):\n"
        + "\n".join(hints)
    )
