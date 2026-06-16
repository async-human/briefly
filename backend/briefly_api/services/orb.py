"""
briefly_api/services/orb.py

Orchestration for the voice orb: a single "turn" chains the speech layer to the
Ask Briefly brain — audio in → STT → Ask Briefly (RAG over the user's corpus
with citations) → text answer. The client then plays the answer via /orb/speak
(TTS), so playback can stream independently of reasoning.

Everything here reuses existing, provider-agnostic pieces:
  - STT  → stt.adapter (local faster-whisper / self-hosted / cloud)
  - brain → services.ask_briefly (retrieval + LLM + citations)
  - TTS  → tts.adapter (local Kokoro / self-hosted / cloud)
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import User
from briefly_api.services.ask_briefly import ask_briefly
from briefly_api.stt.adapter import get_stt_adapter

log = logging.getLogger(__name__)


async def run_orb_turn(
    db: AsyncSession,
    user: User,
    *,
    audio_bytes: bytes | None = None,
    filename: str = "speech.webm",
    content_type: str = "audio/webm",
    text: str | None = None,
    thread_id: str | None = None,
    content_id: str | None = None,
) -> dict:
    """
    One voice turn. Provide either spoken `audio_bytes` (transcribed first) or
    typed `text`. Returns the transcript plus the grounded answer + citations.
    """
    transcript = (text or "").strip()

    if audio_bytes:
        stt = get_stt_adapter()
        transcript = (
            await stt.transcribe(
                audio_bytes,
                filename=filename,
                content_type=content_type,
            )
        ).strip()

    if not transcript:
        raise ValueError("No speech detected — try again.")

    result = await ask_briefly(
        db,
        user,
        transcript,
        thread_id=thread_id,
        content_id=content_id,
    )
    assistant = result.get("assistant", {}) if isinstance(result, dict) else {}

    return {
        "transcript": transcript,
        "thread_id": result.get("thread_id") if isinstance(result, dict) else None,
        "answer": assistant.get("content", ""),
        "citations": assistant.get("citations", []),
    }
