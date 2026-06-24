"""
briefly_api/api/routes/orb_ws.py

WebSocket duplex session for the voice orb — streaming PCM in, partial
transcripts, streaming LLM deltas, client-side TTS playback.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from contextlib import aclosing
from typing import Any, Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from briefly_api.auth.deps import resolve_capture_user_from_token
from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.services import orb as orb_service
from briefly_api.services.orb_session import OrbSessionState, resolve_session
from briefly_api.stt.profile_context import transcription_prompt_for_orb_turn
from briefly_api.stt.streaming import DeepgramStreamSession, StreamTranscriptEvent, open_streaming_stt
from briefly_api.stt.wake_context import (
    BARGE_IN_ENDPOINTING_MS,
    BARGE_IN_STT_PROMPT,
    BARGE_IN_UTTERANCE_END_MS,
    WAKE_ENDPOINTING_MS,
    WAKE_KEYTERMS,
    WAKE_STT_PROMPT,
    WAKE_UTTERANCE_END_MS,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["orb"])

ListenMode = Literal["conversation", "wake", "barge_in"]

_ACTIVE_TURNS: dict[str, asyncio.Task] = {}


async def shutdown_active_orb_turns() -> None:
    """Cancel in-flight WS turns during app shutdown."""
    session_ids = list(_ACTIVE_TURNS.keys())
    for session_id in session_ids:
        await _await_turn_cancel(session_id)


async def _await_turn_cancel(session_id: str) -> None:
    """Cancel an in-flight turn and wait for DB/session cleanup."""
    task = _ACTIVE_TURNS.pop(session_id, None)
    if not task or task.done():
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:
        log.debug("turn task ended with error during cancel", exc_info=True)


async def _send(ws: WebSocket, payload: dict[str, Any]) -> None:
    await ws.send_text(json.dumps(payload))


def _looks_like_barge_in(transcript: str) -> bool:
    norm = re.sub(r"[^\w\s]", " ", (transcript or "").lower())
    norm = " ".join(norm.split())
    if len(norm) < 4:
        return False
    words = norm.split()
    if len(words) >= 2:
        return True
    return len(words) == 1 and len(norm) >= 5


def _wake_match(transcript: str) -> bool:
    return orb_service.transcript_matches_wake_phrase(
        transcript
    ) or orb_service.transcript_likely_wake_phrase(transcript)


class SttRuntime:
    """Manage Deepgram live STT lifecycle — mode-aware (conversation / wake / barge-in)."""

    def __init__(self) -> None:
        self.session: DeepgramStreamSession | None = None
        self.task: asyncio.Task | None = None
        self.mode: ListenMode = "conversation"
        self._lock = asyncio.Lock()

    @property
    def active(self) -> bool:
        return self.session is not None and self.task is not None and not self.task.done()

    async def stop(self) -> None:
        task = self.task
        self.task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        session = self.session
        self.session = None
        if session is not None:
            await session.close()

    async def _open_session(self, mode: ListenMode, user_id: str, session: OrbSessionState) -> bool:
        settings = get_settings()
        if not settings.orb_streaming_stt_enabled:
            return False

        if mode == "wake":
            stt = await open_streaming_stt(
                context_prompt=WAKE_STT_PROMPT,
                extra_keywords=list(WAKE_KEYTERMS),
                endpointing_ms=WAKE_ENDPOINTING_MS,
                utterance_end_ms=WAKE_UTTERANCE_END_MS,
            )
        elif mode == "barge_in":
            stt = await open_streaming_stt(
                context_prompt=BARGE_IN_STT_PROMPT,
                endpointing_ms=BARGE_IN_ENDPOINTING_MS,
                utterance_end_ms=BARGE_IN_UTTERANCE_END_MS,
            )
        else:
            async with SessionLocal() as db:
                prompt = await transcription_prompt_for_orb_turn(
                    db,
                    user_id,
                    session=session,
                    thread_id=session.thread_id,
                )
            stt = await open_streaming_stt(
                context_prompt=prompt,
                endpointing_ms=settings.deepgram_endpointing_ms,
                utterance_end_ms=settings.deepgram_utterance_end_ms,
            )

        self.session = stt
        self.mode = mode
        return True

    async def start(
        self,
        ws: WebSocket,
        user_id: str,
        session: OrbSessionState,
        cancel_holder: list[asyncio.Event],
        *,
        mode: ListenMode = "conversation",
    ) -> bool:
        settings = get_settings()
        if not settings.orb_streaming_stt_enabled:
            return False
        async with self._lock:
            await self.stop()
            try:
                ok = await self._open_session(mode, user_id, session)
                if not ok or self.session is None:
                    return False
                self.task = asyncio.create_task(
                    _stt_listener(ws, self.session, user_id, session, cancel_holder, self)
                )
                return True
            except Exception as exc:
                log.debug("streaming stt unavailable (%s): %s", mode, exc)
                return False

    async def restart(
        self,
        ws: WebSocket,
        user_id: str,
        session: OrbSessionState,
        cancel_holder: list[asyncio.Event],
        *,
        mode: ListenMode | None = None,
    ) -> bool:
        listen_mode = mode or self.mode or "conversation"
        ok = await self.start(ws, user_id, session, cancel_holder, mode=listen_mode)
        await _send(
            ws,
            {"type": "stt_ready", "streaming_stt": ok, "listen_mode": listen_mode},
        )
        return ok


async def _run_turn_stream(
    ws: WebSocket,
    user_id: str,
    session: OrbSessionState,
    transcript: str,
    cancel: asyncio.Event,
) -> None:
    """Stream LLM answer deltas; client synthesizes speech locally."""
    expects_reply = True
    try:
        await _send(ws, {"type": "turn_start", "transcript": transcript})
        events = orb_service.iter_orb_text_turn_events(
            None,
            None,
            transcript,
            user_id=user_id,
            thread_id=session.thread_id,
            session=session,
            surface=session.surface,
        )
        async with aclosing(events) as stream:
            async for event in stream:
                if cancel.is_set():
                    break
                et = event.get("type")
                if et == "meta":
                    if event.get("thread_id"):
                        session.thread_id = event["thread_id"]
                    await _send(ws, {"type": "turn_meta", **event})
                elif et == "delta":
                    await _send(ws, {"type": "turn_delta", "content": event.get("content") or ""})
                elif et == "complete":
                    expects_reply = bool(event.get("expects_reply", True))
                    await _send(ws, {"type": "turn_complete", **event})
        if not cancel.is_set():
            await _send(ws, {"type": "turn_end", "expects_reply": expects_reply})
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("ws turn stream failed session=%s", session.session_id)
        await _send(ws, {"type": "error", "message": "Turn failed — please try again."})


async def _schedule_turn(
    ws: WebSocket,
    user_id: str,
    session: OrbSessionState,
    transcript: str,
    cancel_holder: list[asyncio.Event],
    stt_runtime: SttRuntime,
) -> None:
    await stt_runtime.stop()
    await _await_turn_cancel(session.session_id)
    cancel = asyncio.Event()
    cancel_holder[:] = [cancel]
    task = asyncio.create_task(
        _run_turn_stream(
            ws,
            user_id,
            session,
            transcript,
            cancel,
        )
    )
    _ACTIVE_TURNS[session.session_id] = task


async def _stt_listener(
    ws: WebSocket,
    stt_session: DeepgramStreamSession,
    user_id: str,
    session: OrbSessionState,
    cancel_holder: list[asyncio.Event],
    stt_runtime: SttRuntime,
) -> None:
    finals: list[str] = []
    try:
        async for ev in stt_session.events():
            await _handle_stt_event(
                ws, ev, finals, user_id, session, cancel_holder, stt_runtime
            )
    except asyncio.CancelledError:
        raise
    finally:
        if stt_runtime.session is stt_session:
            stt_runtime.session = None
            stt_runtime.task = None


async def _handle_stt_event(
    ws: WebSocket,
    ev: StreamTranscriptEvent,
    finals: list[str],
    user_id: str,
    session: OrbSessionState,
    cancel_holder: list[asyncio.Event],
    stt_runtime: SttRuntime,
) -> None:
    mode = stt_runtime.mode

    if mode == "wake":
        if ev.text:
            if _wake_match(ev.text):
                await _send(ws, {"type": "wake_detected", "text": ev.text})
                await stt_runtime.stop()
                return
            await _send(
                ws,
                {
                    "type": "partial_transcript" if not ev.is_final else "transcript",
                    "text": ev.text,
                    "is_final": ev.is_final,
                },
            )
            if ev.is_final:
                finals.append(ev.text)
        if not ev.utterance_end:
            return
        transcript = " ".join(finals).strip()
        finals.clear()
        if transcript and _wake_match(transcript):
            await _send(ws, {"type": "wake_detected", "text": transcript})
        await stt_runtime.stop()
        return

    if mode == "barge_in":
        if ev.text and len(ev.text.strip()) >= 3:
            await _send(
                ws,
                {
                    "type": "barge_in_partial",
                    "text": ev.text,
                    "is_final": ev.is_final,
                },
            )
            if ev.is_final:
                finals.append(ev.text)
        if not ev.utterance_end:
            return
        transcript = " ".join(finals).strip()
        finals.clear()
        if _looks_like_barge_in(transcript):
            await _send(ws, {"type": "barge_in_detected", "text": transcript})
        await stt_runtime.stop()
        return

    # conversation mode
    if ev.text:
        await _send(
            ws,
            {
                "type": "partial_transcript" if not ev.is_final else "transcript",
                "text": ev.text,
                "is_final": ev.is_final,
            },
        )
        if ev.is_final:
            finals.append(ev.text)

    if not ev.utterance_end:
        return

    transcript = " ".join(finals).strip()
    finals.clear()
    if len(transcript) < 3:
        return

    # Segment final — client merges continuations and submits via text_turn when the
    # user has finished speaking (avoids cutting off mid-thought on brief pauses).
    await _send(ws, {"type": "speech_final", "text": transcript})
    return


@router.websocket("/orb/session/live")
async def orb_session_live(ws: WebSocket) -> None:
    settings = get_settings()
    if not settings.orb_ws_enabled:
        await ws.close(code=1008)
        return

    await ws.accept()
    user_id: str | None = None
    session: OrbSessionState | None = None
    stt_runtime = SttRuntime()
    cancel_holder: list[asyncio.Event] = [asyncio.Event()]

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            if msg.get("text"):
                frame = json.loads(msg["text"])
                ftype = frame.get("type")

                if ftype == "auth":
                    token = str(frame.get("token") or "").strip()
                    async with SessionLocal() as db:
                        user = await resolve_capture_user_from_token(db, token)
                    if user is None:
                        await _send(ws, {"type": "error", "message": "Unauthorized"})
                        await ws.close(code=1008)
                        return
                    user_id = str(user.id)
                    session = await resolve_session(
                        user_id,
                        session_id=frame.get("session_id"),
                        thread_id=frame.get("thread_id"),
                        surface=str(frame.get("surface") or "desktop"),
                    )
                    streaming = bool(settings.orb_streaming_stt_enabled)
                    await _send(
                        ws,
                        {
                            "type": "session_ready",
                            "session_id": session.session_id,
                            "thread_id": session.thread_id,
                            "streaming_stt": streaming,
                        },
                    )
                    continue

                if ftype == "ping":
                    await _send(ws, {"type": "pong"})
                    continue

                if ftype == "prepare_listen" and user_id and session:
                    await stt_runtime.restart(
                        ws, user_id, session, cancel_holder, mode="conversation"
                    )
                    continue

                if ftype == "prepare_wake_listen" and user_id and session:
                    await stt_runtime.restart(
                        ws, user_id, session, cancel_holder, mode="wake"
                    )
                    continue

                if ftype == "prepare_barge_in" and user_id and session:
                    await stt_runtime.restart(
                        ws, user_id, session, cancel_holder, mode="barge_in"
                    )
                    continue

                if ftype == "interrupt" and session:
                    cancel_holder[0].set()
                    await stt_runtime.stop()
                    await _await_turn_cancel(session.session_id)
                    await _send(ws, {"type": "interrupted"})
                    continue

                if ftype == "end_utterance" and stt_runtime.session is not None:
                    await stt_runtime.session.finalize()
                    continue

                if ftype == "text_turn" and user_id and session:
                    await _schedule_turn(
                        ws,
                        user_id,
                        session,
                        str(frame.get("text") or ""),
                        cancel_holder,
                        stt_runtime,
                    )
                    continue

            if msg.get("bytes") and stt_runtime.session is not None:
                await stt_runtime.session.send_audio(msg["bytes"])

    except WebSocketDisconnect:
        pass
    finally:
        if session:
            await _await_turn_cancel(session.session_id)
        await stt_runtime.stop()
