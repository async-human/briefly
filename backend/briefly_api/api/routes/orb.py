"""
Voice orb endpoints. Authenticated with the capture device token *or* a session
JWT (get_capture_user), so the desktop orb is just another device client.

  POST /orb/turn       audio (or text) → STT → Ask Briefly → {transcript, answer, citations}
  POST /orb/speak      text → TTS audio stream (open Kokoro / self-hosted / cloud)
  GET  /orb/proactive  pending proactive events the orb can surface on its own
"""
from __future__ import annotations

import base64
import binascii
import json
import logging

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.api.schemas import (
    OrbProactiveSeenIn,
    OrbProactiveSnoozeIn,
    OrbProactiveVoiceOut,
    OrbSessionIn,
    OrbSessionOut,
    OrbVoiceConfigOut,
    OrbWelcomeOut,
    OrbSpeakIn,
    OrbTurnJsonIn,
    OrbTurnOut,
    OrbWakeCheckIn,
    OrbWakeCheckOut,
    ProactiveEventOut,
)
from briefly_api.auth.deps import get_capture_user
from briefly_api.db.engine import get_db
from briefly_api.db.models import User
from briefly_api.services import orb as orb_service
from briefly_api.services.orb_session import resolve_session
from briefly_api.tts.adapter import TTSError, get_tts_adapter

log = logging.getLogger(__name__)

router = APIRouter(tags=["orb"])


async def _wake_check_bytes(
    db: AsyncSession,
    user: User,
    audio_bytes: bytes,
    *,
    filename: str,
    content_type: str,
) -> OrbWakeCheckOut:
    result = await orb_service.check_wake_phrase(
        db,
        user,
        audio_bytes=audio_bytes,
        filename=filename,
        content_type=content_type,
    )
    snippet = (result.get("transcript") or "")[:80]
    log.info("orb_wake_check user=%s wake=%s transcript=%r", user.id, result["wake"], snippet)
    return OrbWakeCheckOut(**result)


@router.post("/orb/session", response_model=OrbSessionOut)
async def orb_create_session(
    body: OrbSessionIn,
    user: User = Depends(get_capture_user),
) -> OrbSessionOut:
    state = await resolve_session(
        user.id,
        session_id=body.session_id,
        thread_id=body.thread_id,
        surface=body.surface or "desktop",
    )
    return OrbSessionOut(session_id=state.session_id, thread_id=state.thread_id)


@router.get("/orb/welcome", response_model=OrbWelcomeOut)
async def orb_welcome(
    user: User = Depends(get_capture_user),
    db: AsyncSession = Depends(get_db),
) -> OrbWelcomeOut:
    """Personalized spoken greeting when the voice orb session starts."""
    from briefly_api.services.orb_welcome import build_orb_welcome

    payload = await build_orb_welcome(db, user.id)
    return OrbWelcomeOut(**payload)


@router.get("/orb/voice-config", response_model=OrbVoiceConfigOut)
async def get_orb_voice_config(
    user: User = Depends(get_capture_user),  # noqa: ARG001
) -> OrbVoiceConfigOut:
    """Pinned TTS voice identity for the orb client."""
    from briefly_api.services.orb_voice import orb_voice_config

    return OrbVoiceConfigOut(**orb_voice_config())


@router.post("/orb/turn", response_model=OrbTurnOut)
async def orb_turn(
    audio: UploadFile | None = File(default=None),
    text: str | None = Form(default=None),
    thread_id: str | None = Form(default=None),
    session_id: str | None = Form(default=None),
    surface: str | None = Form(default=None),
    content_id: str | None = Form(default=None),
    user: User = Depends(get_capture_user),
    db: AsyncSession = Depends(get_db),
) -> OrbTurnOut:
    audio_bytes = await audio.read() if audio is not None else None
    try:
        result = await orb_service.run_orb_turn(
            db,
            user,
            audio_bytes=audio_bytes,
            filename=(audio.filename if audio else "speech.webm") or "speech.webm",
            content_type=(audio.content_type if audio else "audio/webm") or "audio/webm",
            text=text,
            thread_id=thread_id,
            session_id=session_id,
            surface=surface or "desktop",
            content_id=content_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return OrbTurnOut(**result)


@router.post("/orb/turn/json", response_model=OrbTurnOut)
async def orb_turn_json(
    body: OrbTurnJsonIn,
    user: User = Depends(get_capture_user),
    db: AsyncSession = Depends(get_db),
) -> OrbTurnOut:
    """Voice turn via JSON + base64 audio — reliable for Tauri desktop (no multipart)."""
    audio_bytes: bytes | None = None
    if body.audio_base64:
        try:
            audio_bytes = base64.b64decode(body.audio_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid audio_base64") from exc
    try:
        result = await orb_service.run_orb_turn(
            db,
            user,
            audio_bytes=audio_bytes,
            filename=body.filename or "turn.webm",
            content_type=body.content_type or "audio/webm",
            text=body.text,
            thread_id=body.thread_id,
            session_id=body.session_id,
            surface=body.surface or "desktop",
            content_id=body.content_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return OrbTurnOut(**result)


@router.post("/orb/turn/stream")
async def orb_turn_stream(
    body: OrbTurnJsonIn,
    user: User = Depends(get_capture_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """SSE voice turn — streams LLM tokens; client starts TTS on first sentence."""
    audio_bytes: bytes | None = None
    if body.audio_base64:
        try:
            audio_bytes = base64.b64decode(body.audio_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid audio_base64") from exc

    async def event_generator():
        try:
            async for chunk in orb_service.stream_orb_turn(
                db,
                user,
                audio_bytes=audio_bytes,
                filename=body.filename or "turn.webm",
                content_type=body.content_type or "audio/webm",
                text=body.text,
                thread_id=body.thread_id,
                session_id=body.session_id,
                surface=body.surface or "desktop",
                content_id=body.content_id,
            ):
                yield chunk
        except ValueError as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"
        except Exception:
            log.exception("orb turn stream failed for user %s", getattr(user, "id", "?"))
            yield (
                "data: "
                + json.dumps(
                    {"type": "error", "message": "Turn failed — please try again."},
                    ensure_ascii=False,
                )
                + "\n\n"
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/orb/wake-check", response_model=OrbWakeCheckOut)
async def orb_wake_check(
    audio: UploadFile = File(...),
    user: User = Depends(get_capture_user),
    db: AsyncSession = Depends(get_db),
) -> OrbWakeCheckOut:
    """STT-only wake phrase check for always-on desktop orb listening."""
    audio_bytes = await audio.read()
    return await _wake_check_bytes(
        db,
        user,
        audio_bytes,
        filename=audio.filename or "wake.webm",
        content_type=audio.content_type or "audio/webm",
    )


@router.post("/orb/wake-check/json", response_model=OrbWakeCheckOut)
async def orb_wake_check_json(
    body: OrbWakeCheckIn,
    user: User = Depends(get_capture_user),
    db: AsyncSession = Depends(get_db),
) -> OrbWakeCheckOut:
    """Wake check via JSON + base64 — reliable for Tauri desktop (no multipart)."""
    try:
        audio_bytes = base64.b64decode(body.audio_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid audio_base64") from exc
    return await _wake_check_bytes(
        db,
        user,
        audio_bytes,
        filename=body.filename or "wake.webm",
        content_type=body.content_type or "audio/webm",
    )


@router.post("/orb/speak")
async def orb_speak(
    body: OrbSpeakIn,
    user: User = Depends(get_capture_user),
    db: AsyncSession = Depends(get_db),  # noqa: ARG001 — auth dep needs a session
) -> Response:
    tts = get_tts_adapter()
    if not tts.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TTS is disabled (set TTS_PROVIDER).",
        )
    try:
        # Use full synthesis here so transport/provider failures are raised before
        # response streaming begins; that avoids ASGI task-group crashes and
        # returns a clean HTTP error to mobile/desktop clients.
        audio = await tts.synthesize(body.text, voice=body.voice)
    except (TTSError, httpx.HTTPError) as exc:
        log.warning("orb_speak failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TTS backend unavailable. Check TTS_PROVIDER/TTS_BASE_URL settings.",
        ) from exc
    return Response(content=audio, media_type=tts.content_type())


@router.post("/orb/speak/stream")
async def orb_speak_stream(
    body: OrbSpeakIn,
    user: User = Depends(get_capture_user),
    db: AsyncSession = Depends(get_db),  # noqa: ARG001
) -> StreamingResponse:
    tts = get_tts_adapter()
    if not tts.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TTS is disabled (set TTS_PROVIDER).",
        )

    async def _stream():
        try:
            async for chunk in tts.synthesize_stream(body.text, voice=body.voice):
                if chunk:
                    yield chunk
        except (TTSError, httpx.HTTPError) as exc:
            log.warning("orb_speak_stream failed: %s", exc)
            return

    return StreamingResponse(_stream(), media_type=tts.content_type())


@router.get("/orb/proactive", response_model=list[ProactiveEventOut])
async def orb_proactive(
    user: User = Depends(get_capture_user),
    db: AsyncSession = Depends(get_db),
) -> list[ProactiveEventOut]:
    """Pending proactive events the orb can surface mid-day (reuses the brief's brain)."""
    from briefly_api.agents.proactive.proactive_surfacing import get_for_api

    events = await get_for_api(db, user.id)
    return [ProactiveEventOut(**e) for e in events]


@router.get("/orb/proactive/voice", response_model=OrbProactiveVoiceOut)
async def orb_proactive_voice(
    user: User = Depends(get_capture_user),
    db: AsyncSession = Depends(get_db),  # noqa: ARG001 — auth dep needs a session
) -> OrbProactiveVoiceOut:
    """Should the always-on orb speak up right now? Returns a gated, spoken-style
    script for any pending proactive events that pass the context gate (quiet
    hours / in a meeting / "afraid to miss"). The orb speaks it via /orb/speak,
    then acks via /orb/proactive/spoken so it isn't repeated."""
    from briefly_api.services.voice_briefing import build_orb_proactive_voice

    result = await build_orb_proactive_voice(user.id)
    return OrbProactiveVoiceOut(**result)


@router.post(
    "/orb/proactive/spoken",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def orb_proactive_spoken(
    body: OrbProactiveSeenIn,
    user: User = Depends(get_capture_user),  # noqa: ARG001 — auth dep
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Mark proactive events as delivered-by-voice (pushed) so the orb won't
    re-speak them. They remain in the inbox until the user acts on them."""
    from briefly_api.agents.proactive.proactive_surfacing import mark_pushed

    await mark_pushed(db, body.event_ids)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/orb/proactive/seen",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def orb_proactive_seen(
    body: OrbProactiveSeenIn,
    user: User = Depends(get_capture_user),  # noqa: ARG001 — auth dep
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Mark proactive events as surfaced so they don't resurface once the orb shows them."""
    from briefly_api.agents.proactive.proactive_surfacing import mark_surfaced

    await mark_surfaced(db, body.event_ids)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/orb/proactive/{event_id}/dismiss",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def orb_proactive_dismiss(
    event_id: str,
    user: User = Depends(get_capture_user),  # noqa: ARG001 — auth dep
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Dismiss a proactive event (user said 'not interested')."""
    from briefly_api.agents.proactive.proactive_surfacing import mark_dismissed

    await mark_dismissed(db, event_id)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/orb/proactive/{event_id}/snooze",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def orb_proactive_snooze(
    event_id: str,
    body: OrbProactiveSnoozeIn,
    user: User = Depends(get_capture_user),  # noqa: ARG001 — auth dep
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Snooze a proactive event out of the inbox for a few hours."""
    from briefly_api.agents.proactive.proactive_surfacing import snooze_event

    await snooze_event(db, event_id, hours=body.hours)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
