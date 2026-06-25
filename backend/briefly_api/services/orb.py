"""
briefly_api/services/orb.py

Orchestration for the voice orb. One "turn" is: audio in → STT → route to a tool
(or the Ask Briefly brain) → text answer + citations. The client plays the
answer via /orb/speak (TTS) so playback streams independently of reasoning.

Routing is handled by `classify_orb_intent` + `orb_turn_engine.execute_routed_turn`:
direct tool calls for fast patterns, Ask Briefly for open questions, and a
capped agent loop for multi-step tasks.

Everything reuses provider-agnostic pieces: STT (stt.adapter), brain
(ask_briefly), TTS (tts.adapter via the /orb/speak route).
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.engine import SessionLocal

from briefly_api.db.models import FollowUpThread, User
from briefly_api.services.ask_briefly import ask_briefly
from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_session import (
    OrbSessionState,
    resolve_session,
    update_session_after_turn,
)
from briefly_api.services.orb_tools import DATA_TOOLS, OrbTool
from briefly_api.stt.adapter import get_stt_adapter

log = logging.getLogger(__name__)


# ── Ask Briefly as a registry tool ───────────────────────────────────────────
# Defined here (not in orb_tools) so it calls the module-level `ask_briefly`,
# which tests monkeypatch and which is the single source of brain behaviour.


async def _ask_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str,
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    result = await ask_briefly(
        db, user, transcript, thread_id=thread_id, content_id=content_id, voice=True
    )
    assistant = result.get("assistant", {}) if isinstance(result, dict) else {}
    return {
        "answer": assistant.get("content", ""),
        "citations": assistant.get("citations", []),
        "thread_id": result.get("thread_id") if isinstance(result, dict) else None,
    }


ASK_TOOL = OrbTool(
    name="ask_briefly",
    description="General-purpose question answering over the user's corpus, with citations.",
    handler=_ask_handler,
)

REGISTRY: list[OrbTool] = [*DATA_TOOLS, ASK_TOOL]


async def _thread_message_count(
    db: AsyncSession,
    user_id: str,
    thread_id: str | None,
) -> int:
    if not thread_id:
        return 0
    result = await db.execute(
        select(FollowUpThread).where(
            FollowUpThread.id == thread_id,
            FollowUpThread.user_id == user_id,
        )
    )
    thread = result.scalar_one_or_none()
    if not thread:
        return 0
    return len(thread.messages or [])


async def _persist_orb_exchange(
    db: AsyncSession,
    user_id: str,
    thread_id: str | None,
    user_text: str,
    assistant_text: str,
    *,
    citations: list | None = None,
) -> str | None:
    """Append a voice turn to FollowUpThread so follow-ups retain context."""
    answer = (assistant_text or "").strip()
    question = (user_text or "").strip()
    if not answer or not question:
        return thread_id

    now = datetime.now(timezone.utc).isoformat()
    thread: FollowUpThread | None = None
    if thread_id:
        result = await db.execute(
            select(FollowUpThread).where(
                FollowUpThread.id == thread_id,
                FollowUpThread.user_id == user_id,
            )
        )
        thread = result.scalar_one_or_none()

    if thread is None:
        thread = FollowUpThread(
            id=str(uuid.uuid4()),
            user_id=user_id,
            messages=[],
        )
        db.add(thread)

    thread.messages = list(thread.messages or []) + [
        {"role": "user", "content": question, "timestamp": now},
        {
            "role": "assistant",
            "content": answer,
            "citations": citations or [],
            "timestamp": now,
        },
    ]
    await db.commit()
    await db.refresh(thread)
    return thread.id


async def _persist_agent_run(
    user_id: str, goal: str, result, duration_ms: int
) -> None:
    """Write the audit record for an agent run on its own session, so auditing never
    affects or depends on the request transaction. Best-effort — never raises."""
    from briefly_api.db.models import AgentRun

    try:
        async with SessionLocal() as session:
            session.add(
                AgentRun(
                    user_id=user_id,
                    surface="orb",
                    goal=(goal or "")[:2000],
                    answer=(result.answer or "")[:4000],
                    tools_used=list(result.tools_used or []),
                    stopped_reason=result.stopped_reason,
                    steps=[s.to_dict() for s in result.steps],
                    thread_id=result.thread_id,
                    duration_ms=duration_ms,
                )
            )
            await session.commit()
    except Exception:
        log.exception("agent run audit persist failed for user %s", user_id)


# ── Public entrypoint ────────────────────────────────────────────────────────


def transcript_matches_wake_phrase(transcript: str) -> bool:
    """True when STT output contains the orb wake phrase (with common mis-hears)."""
    norm = re.sub(r"[^\w\s]", " ", (transcript or "").lower())
    norm = " ".join(norm.split())
    if not norm:
        return False
    phrases = (
        "hey briefly",
        "hi briefly",
        "hay briefly",
        "a briefly",
        "hey brief",
        "hi brief",
        "hey briefley",
        "hey brieflee",
        "hey breifly",
        "hey bri",
        "hi bri",
    )
    if any(p in norm for p in phrases):
        return True
    words = norm.split()
    for i, word in enumerate(words):
        if word in ("hey", "hi", "hay", "a") and "briefly" in words[i : i + 4]:
            return True
        if word in ("hey", "hi", "hay") and i + 1 < len(words) and words[i + 1].startswith("bri"):
            return True
    return False


def transcript_likely_wake_phrase(transcript: str) -> bool:
    """Fuzzy wake match for partial STT — avoids missing clipped wake phrases."""
    if transcript_matches_wake_phrase(transcript):
        return True
    norm = re.sub(r"[^\w\s]", " ", (transcript or "").lower())
    norm = " ".join(norm.split())
    if not norm or len(norm) > 32:
        return False
    if norm in ("briefly", "brieflee", "breifly", "briefley"):
        return True
    if norm.startswith("briefly ") and len(norm.split()) <= 3:
        return True
    if re.match(r"^(hey|hi|hay|a)\s+bri", norm):
        return True
    if "briefly" in norm.split() and len(norm.split()) <= 4:
        return True
    return False


async def check_wake_phrase(
    db: AsyncSession | None,
    user: User,
    *,
    audio_bytes: bytes,
    filename: str = "wake.webm",
    content_type: str = "audio/webm",
) -> dict:
    """Transcribe a short wake clip; STT only — no agent turn."""
    if not audio_bytes or len(audio_bytes) < 200:
        return {"transcript": "", "wake": False}
    from briefly_api.stt.wake_context import WAKE_STT_PROMPT

    stt = get_stt_adapter()
    context_prompt = WAKE_STT_PROMPT
    try:
        transcript = (
            await stt.transcribe(
                audio_bytes,
                filename=filename,
                content_type=content_type,
                context_prompt=context_prompt,
            )
        ).strip()
    except Exception as exc:
        log.warning("wake phrase STT failed: %s", exc)
        return {"transcript": "", "wake": False}
    wake = transcript_matches_wake_phrase(transcript) or transcript_likely_wake_phrase(
        transcript
    )
    return {
        "transcript": transcript,
        "wake": wake,
    }


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
    session_id: str | None = None,
    surface: str = "desktop",
) -> dict:
    """
    One voice turn. Provide either spoken `audio_bytes` (transcribed first) or
    typed `text`. Returns the transcript plus a grounded answer + citations.
    """
    timings: dict[str, int] = {}
    started = time.monotonic()
    session: OrbSessionState | None = None
    if db is not None and getattr(user, "id", None):
        session = await resolve_session(
            user.id,
            session_id=session_id,
            thread_id=thread_id,
            surface=surface,
        )
        if session.thread_id and not thread_id:
            thread_id = session.thread_id

    transcript = (text or "").strip()

    if audio_bytes:
        if len(audio_bytes) < 400:
            raise ValueError("Recording too short — try again.")
        stt_started = time.monotonic()
        stt = get_stt_adapter()
        context_prompt = None
        if db is not None and getattr(user, "id", None):
            from briefly_api.stt.profile_context import transcription_prompt_for_orb_turn

            context_prompt = await transcription_prompt_for_orb_turn(
                db,
                user.id,
                session=session,
                thread_id=thread_id or (session.thread_id if session else None),
            )
        try:
            transcript = (
                await stt.transcribe(
                    audio_bytes,
                    filename=filename,
                    content_type=content_type,
                    context_prompt=context_prompt,
                )
            ).strip()
        except (httpx.HTTPStatusError, ValueError) as exc:
            if isinstance(exc, httpx.HTTPStatusError):
                log.warning(
                    "orb STT failed user=%s status=%s bytes=%d type=%s",
                    getattr(user, "id", None),
                    exc.response.status_code,
                    len(audio_bytes),
                    content_type,
                )
            else:
                log.warning(
                    "orb STT failed user=%s decode bytes=%d type=%s: %s",
                    getattr(user, "id", None),
                    len(audio_bytes),
                    content_type,
                    exc,
                )
            raise ValueError("Couldn't process that audio — please try again.") from exc
        timings["stt_ms"] = int((time.monotonic() - stt_started) * 1000)

    if not transcript:
        raise ValueError("No speech detected — try again.")

    if db is not None and getattr(user, "id", None):
        resolved_thread = thread_id or (session.thread_id if session else None)
        thread_msg_count = await _thread_message_count(db, user.id, resolved_thread)
        route_started = time.monotonic()
        decision = await classify_orb_intent(
            transcript,
            thread_message_count=thread_msg_count,
            session=session,
            session_thread_id=session.thread_id if session else None,
            session_has_prior_turn=bool(session and session.last_transcript),
            user_id=str(user.id),
        )
        timings["route_ms"] = int((time.monotonic() - route_started) * 1000)

        from briefly_api.services.orb_turn_engine import execute_routed_turn

        exec_started = time.monotonic()
        payload = await execute_routed_turn(
            db,
            user,
            transcript,
            decision=decision,
            thread_id=resolved_thread,
            content_id=content_id,
            surface=surface,
            session=session,
        )
        timings["agent_ms"] = int((time.monotonic() - exec_started) * 1000)
        timings["total_ms"] = int((time.monotonic() - started) * 1000)
        payload["timings"] = timings
        payload["session_id"] = session.session_id if session else None

        trace = payload.get("tool_trace") or []
        tool_name = trace[0].get("tool") if trace else None
        if session:
            await update_session_after_turn(
                session,
                thread_id=payload.get("thread_id"),
                transcript=transcript,
                draft_id=payload.get("draft_id"),
                last_tool=tool_name,
                route_kind=str(payload.get("route_kind") or decision.kind),
                route_reason=str(payload.get("route_reason") or decision.reason or ""),
                last_answer=str(payload.get("answer") or "")[:4000],
                tool_slots=dict(session.tool_slots or {}),
            )
        persisted = await _persist_orb_exchange(
            db,
            user.id,
            payload.get("thread_id") or resolved_thread,
            transcript,
            payload.get("answer", ""),
            citations=payload.get("citations") or [],
        )
        if persisted:
            payload["thread_id"] = persisted

        log.info(
            "orb_turn user=%s route=%s reason=%s trace=%s ms=%s",
            user.id,
            payload.get("route_kind"),
            payload.get("route_reason"),
            [t.get("tool") for t in trace],
            timings.get("total_ms"),
        )
        return payload

    # ── Default: straight to the brain (no db / user context)
    agent_started = time.monotonic()
    result_data = await ask_briefly(
        db, user, transcript, thread_id=thread_id, content_id=content_id, voice=True
    )
    timings["agent_ms"] = int((time.monotonic() - agent_started) * 1000)
    assistant = result_data.get("assistant", {}) if isinstance(result_data, dict) else {}
    answer = assistant.get("content", "")
    payload = {
        "transcript": transcript,
        "thread_id": result_data.get("thread_id") if isinstance(result_data, dict) else None,
        "answer": answer,
        "citations": assistant.get("citations", []),
        "tool_trace": [{"tool": "ask_briefly"}],
        "expects_reply": bool(str(answer).strip().endswith("?")),
        "session_id": session.session_id if session else None,
        "timings": timings,
    }
    timings["total_ms"] = int((time.monotonic() - started) * 1000)
    if session:
        await update_session_after_turn(
            session,
            thread_id=payload.get("thread_id"),
            transcript=transcript,
            route_kind="ask_briefly",
            route_reason="fallback_ask_briefly",
            last_answer=str(answer)[:4000],
        )
    return payload


def _orb_sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def iter_orb_text_turn_events(
    db: AsyncSession | None,
    user: User | None,
    transcript: str,
    *,
    user_id: str | None = None,
    thread_id: str | None = None,
    content_id: str | None = None,
    session: OrbSessionState | None = None,
    session_id: str | None = None,
    surface: str = "desktop",
    timings: dict[str, int] | None = None,
    started: float | None = None,
) -> AsyncIterator[dict]:
    """Stream structured turn events after transcript is known (HTTP SSE + WS)."""
    from briefly_api.services.orb_turn_engine import iter_orb_turn_events

    async for event in iter_orb_turn_events(
        db,
        user,
        transcript,
        user_id=user_id,
        thread_id=thread_id,
        content_id=content_id,
        session=session,
        session_id=session_id,
        surface=surface,
        timings=timings,
        started=started,
    ):
        yield event


async def stream_orb_turn(
    db: AsyncSession,
    user: User,
    *,
    audio_bytes: bytes | None = None,
    filename: str = "speech.webm",
    content_type: str = "audio/webm",
    text: str | None = None,
    thread_id: str | None = None,
    content_id: str | None = None,
    session_id: str | None = None,
    surface: str = "desktop",
) -> AsyncIterator[str]:
    """
    SSE stream for a voice turn. Yields meta + LLM deltas for ask_briefly routes,
    or a single complete event for tool routes (client plays TTS after).
    """
    timings: dict[str, int] = {}
    started = time.monotonic()
    session: OrbSessionState | None = None
    if db is not None and getattr(user, "id", None):
        session = await resolve_session(
            user.id,
            session_id=session_id,
            thread_id=thread_id,
            surface=surface,
        )
        if session.thread_id and not thread_id:
            thread_id = session.thread_id

    transcript = (text or "").strip()

    if audio_bytes:
        if len(audio_bytes) < 400:
            raise ValueError("Recording too short — try again.")
        stt_started = time.monotonic()
        stt = get_stt_adapter()
        context_prompt = None
        if db is not None and getattr(user, "id", None):
            from briefly_api.stt.profile_context import transcription_prompt_for_orb_turn

            context_prompt = await transcription_prompt_for_orb_turn(
                db,
                user.id,
                session=session,
                thread_id=thread_id or (session.thread_id if session else None),
            )
        try:
            transcript = (
                await stt.transcribe(
                    audio_bytes,
                    filename=filename,
                    content_type=content_type,
                    context_prompt=context_prompt,
                )
            ).strip()
        except (httpx.HTTPStatusError, ValueError) as exc:
            if isinstance(exc, httpx.HTTPStatusError):
                log.warning(
                    "orb stream STT failed user=%s status=%s",
                    getattr(user, "id", None),
                    exc.response.status_code,
                )
            else:
                log.warning(
                    "orb stream STT failed user=%s decode: %s",
                    getattr(user, "id", None),
                    exc,
                )
            raise ValueError("Couldn't process that audio — please try again.") from exc
        timings["stt_ms"] = int((time.monotonic() - stt_started) * 1000)

    if not transcript:
        raise ValueError("No speech detected — try again.")

    async for event in iter_orb_text_turn_events(
        db,
        user,
        transcript,
        thread_id=thread_id or (session.thread_id if session else None),
        content_id=content_id,
        session=session,
        session_id=session_id,
        surface=surface,
        timings=timings,
        started=started,
    ):
        yield _orb_sse_event(event)
