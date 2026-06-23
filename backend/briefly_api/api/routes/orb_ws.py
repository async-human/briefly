"""
briefly_api/api/routes/orb_ws.py

WebSocket duplex session for the voice orb — streaming audio in, partial
transcripts, turn results, and streaming TTS out.
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
from briefly_api.services.orb_session import OrbSessionState, resolve_session, update_session_after_turn
from briefly_api.stt.profile_context import transcription_prompt_for_user
from briefly_api.stt.streaming import DeepgramStreamSession, StreamTranscriptEvent, open_streaming_stt
from briefly_api.tts.adapter import get_tts_adapter

log = logging.getLogger(__name__)

router = APIRouter(tags=["orb"])

_ACTIVE_TURNS: dict[str, asyncio.Task] = {}


def _cancel_turn(session_id: str) -> None:
    task = _ACTIVE_TURNS.pop(session_id, None)
    if task and not task.done():
        task.cancel()


async def _send(ws: WebSocket, payload: dict[str, Any]) -> None:
    await ws.send_text(json.dumps(payload))


async def _stream_tts(ws: WebSocket, text: str, *, cancel: asyncio.Event) -> None:
    tts = get_tts_adapter()
    if not tts.enabled or cancel.is_set():
        return
    try:
        async for chunk in tts.synthesize_stream(text):
            if cancel.is_set():
                break
            if chunk:
                await ws.send_bytes(chunk)
    except Exception:
        log.debug("ws tts stream failed", exc_info=True)


async def _run_turn(
    ws: WebSocket,
    user: User,
    session: OrbSessionState,
    transcript: str,
    tts_cancel: asyncio.Event,
) -> None:
    async with SessionLocal() as db:
        result = await orb_service.run_orb_turn(
            db,
            user,
            text=transcript,
            thread_id=session.thread_id,
            session_id=session.session_id,
            surface=session.surface,
        )
    await update_session_after_turn(
        session,
        thread_id=result.get("thread_id"),
        transcript=transcript,
    )
    await _send(ws, {"type": "turn_start"})
    await _send(ws, {"type": "turn_result", **result})
    answer = str(result.get("answer") or "")
    if answer:
        await _stream_tts(ws, answer, cancel=tts_cancel)
    await _send(ws, {"type": "turn_end", "expects_reply": bool(result.get("expects_reply"))})


async def _stt_listener(
    ws: WebSocket,
    stt_session: DeepgramStreamSession,
    user: User,
    session: OrbSessionState,
    tts_cancel_holder: list[asyncio.Event],
) -> None:
    finals: list[str] = []
    async for ev in stt_session.events():
        await _handle_stt_event(ws, ev, finals, user, session, tts_cancel_holder)


async def _handle_stt_event(
    ws: WebSocket,
    ev: StreamTranscriptEvent,
    finals: list[str],
    user: User,
    session: OrbSessionState,
    tts_cancel_holder: list[asyncio.Event],
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

    # Only end the user's turn on Deepgram UtteranceEnd — not on speech_final
    # between phrases (that caused premature "thinking" mid-sentence).
    if not ev.utterance_end:
        return

    transcript = " ".join(finals).strip()
    finals.clear()
    if len(transcript) < 4:
        return

    await _send(ws, {"type": "speech_final", "text": transcript})
    _cancel_turn(session.session_id)
    tts_cancel = asyncio.Event()
    tts_cancel_holder[:] = [tts_cancel]
    task = asyncio.create_task(_run_turn(ws, user, session, transcript, tts_cancel))
    _ACTIVE_TURNS[session.session_id] = task


@router.websocket("/orb/session/live")
async def orb_session_live(ws: WebSocket) -> None:
    settings = get_settings()
    if not settings.orb_ws_enabled:
        await ws.close(code=1008)
        return

    await ws.accept()
    user: User | None = None
    session: OrbSessionState | None = None
    stt_session: DeepgramStreamSession | None = None
    stt_task: asyncio.Task | None = None
    tts_cancel_holder: list[asyncio.Event] = [asyncio.Event()]

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
                    if settings.orb_streaming_stt_enabled:
                        async with SessionLocal() as db:
                            prompt = await transcription_prompt_for_user(db, user.id)
                        try:
                            stt_session = await open_streaming_stt(context_prompt=prompt)
                            stt_task = asyncio.create_task(
                                _stt_listener(ws, stt_session, user, session, tts_cancel_holder)
                            )
                        except Exception as exc:
                            log.debug("streaming stt unavailable: %s", exc)
                    await _send(
                        ws,
                        {
                            "type": "session_ready",
                            "session_id": session.session_id,
                            "thread_id": session.thread_id,
                            "streaming_stt": stt_session is not None,
                        },
                    )
                    continue

                if ftype == "interrupt" and session:
                    tts_cancel_holder[0].set()
                    _cancel_turn(session.session_id)
                    await _send(ws, {"type": "interrupted"})
                    continue

                if ftype == "text_turn" and user and session:
                    _cancel_turn(session.session_id)
                    tts_cancel = asyncio.Event()
                    tts_cancel_holder[:] = [tts_cancel]
                    task = asyncio.create_task(
                        _run_turn(ws, user, session, str(frame.get("text") or ""), tts_cancel)
                    )
                    _ACTIVE_TURNS[session.session_id] = task
                    continue

            if msg.get("bytes") and stt_session is not None:
                await stt_session.send_audio(msg["bytes"])

    except WebSocketDisconnect:
        pass
    finally:
        if session:
            _cancel_turn(session.session_id)
        if stt_task is not None:
            stt_task.cancel()
        if stt_session is not None:
            await stt_session.close()
