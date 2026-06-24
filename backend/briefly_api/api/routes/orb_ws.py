"""
briefly_api/api/routes/orb_ws.py

WebSocket duplex session for the voice orb — streaming PCM in, partial
transcripts, streaming LLM deltas, client-side TTS playback.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from briefly_api.auth.deps import resolve_capture_user_from_token
from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import User
from briefly_api.services import orb as orb_service
from briefly_api.services.orb_session import OrbSessionState, resolve_session
from briefly_api.stt.profile_context import transcription_prompt_for_orb_turn
from briefly_api.stt.streaming import DeepgramStreamSession, StreamTranscriptEvent, open_streaming_stt

log = logging.getLogger(__name__)

router = APIRouter(tags=["orb"])

_ACTIVE_TURNS: dict[str, asyncio.Task] = {}


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


class SttRuntime:
    """Manage Deepgram live STT lifecycle — restart after each utterance/turn."""

    def __init__(self) -> None:
        self.session: DeepgramStreamSession | None = None
        self.task: asyncio.Task | None = None
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

    async def start(
        self,
        ws: WebSocket,
        user: User,
        session: OrbSessionState,
        cancel_holder: list[asyncio.Event],
    ) -> bool:
        settings = get_settings()
        if not settings.orb_streaming_stt_enabled:
            return False
        async with self._lock:
            await self.stop()
            try:
                async with SessionLocal() as db:
                    prompt = await transcription_prompt_for_orb_turn(
                        db,
                        user.id,
                        session=session,
                        thread_id=session.thread_id,
                    )
                stt = await open_streaming_stt(context_prompt=prompt)
                self.session = stt
                self.task = asyncio.create_task(
                    _stt_listener(ws, stt, user, session, cancel_holder, self)
                )
                return True
            except Exception as exc:
                log.debug("streaming stt unavailable: %s", exc)
                return False

    async def restart(
        self,
        ws: WebSocket,
        user: User,
        session: OrbSessionState,
        cancel_holder: list[asyncio.Event],
    ) -> bool:
        ok = await self.start(ws, user, session, cancel_holder)
        await _send(ws, {"type": "stt_ready", "streaming_stt": ok})
        return ok


async def _run_turn_stream(
    ws: WebSocket,
    user: User,
    session: OrbSessionState,
    transcript: str,
    cancel: asyncio.Event,
    *,
    stt_runtime: SttRuntime | None = None,
    cancel_holder: list[asyncio.Event] | None = None,
) -> None:
    """Stream LLM answer deltas; client synthesizes speech locally."""
    expects_reply = True
    try:
        await _send(ws, {"type": "turn_start", "transcript": transcript})
        async with SessionLocal() as db:
            async for event in orb_service.iter_orb_text_turn_events(
                db,
                user,
                transcript,
                thread_id=session.thread_id,
                session=session,
                surface=session.surface,
            ):
                if cancel.is_set():
                    return
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
    finally:
        if stt_runtime is not None and cancel_holder is not None:
            await stt_runtime.restart(ws, user, session, cancel_holder)


async def _schedule_turn(
    ws: WebSocket,
    user: User,
    session: OrbSessionState,
    transcript: str,
    cancel_holder: list[asyncio.Event],
    stt_runtime: SttRuntime,
) -> None:
    await _await_turn_cancel(session.session_id)
    cancel = asyncio.Event()
    cancel_holder[:] = [cancel]
    task = asyncio.create_task(
        _run_turn_stream(
            ws,
            user,
            session,
            transcript,
            cancel,
            stt_runtime=stt_runtime,
            cancel_holder=cancel_holder,
        )
    )
    _ACTIVE_TURNS[session.session_id] = task


async def _stt_listener(
    ws: WebSocket,
    stt_session: DeepgramStreamSession,
    user: User,
    session: OrbSessionState,
    cancel_holder: list[asyncio.Event],
    stt_runtime: SttRuntime,
) -> None:
    finals: list[str] = []
    try:
        async for ev in stt_session.events():
            await _handle_stt_event(
                ws, ev, finals, user, session, cancel_holder, stt_runtime
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
    user: User,
    session: OrbSessionState,
    cancel_holder: list[asyncio.Event],
    stt_runtime: SttRuntime,
) -> None:
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
        await stt_runtime.restart(ws, user, session, cancel_holder)
        return

    await _send(ws, {"type": "speech_final", "text": transcript})
    await _schedule_turn(ws, user, session, transcript, cancel_holder, stt_runtime)


@router.websocket("/orb/session/live")
async def orb_session_live(ws: WebSocket) -> None:
    settings = get_settings()
    if not settings.orb_ws_enabled:
        await ws.close(code=1008)
        return

    await ws.accept()
    user: User | None = None
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
                    session = await resolve_session(
                        user.id,
                        session_id=frame.get("session_id"),
                        thread_id=frame.get("thread_id"),
                        surface=str(frame.get("surface") or "desktop"),
                    )
                    streaming = False
                    if settings.orb_streaming_stt_enabled and user and session:
                        streaming = await stt_runtime.start(ws, user, session, cancel_holder)
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

                if ftype == "prepare_listen" and user and session:
                    await stt_runtime.restart(ws, user, session, cancel_holder)
                    continue

                if ftype == "interrupt" and session:
                    cancel_holder[0].set()
                    await _await_turn_cancel(session.session_id)
                    await _send(ws, {"type": "interrupted"})
                    continue

                if ftype == "end_utterance" and stt_runtime.session is not None:
                    await stt_runtime.session.finalize()
                    continue

                if ftype == "text_turn" and user and session:
                    await _schedule_turn(
                        ws,
                        user,
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
