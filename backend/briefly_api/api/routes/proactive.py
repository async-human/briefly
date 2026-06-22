"""
briefly_api/api/routes/proactive.py

Proactive surfacing endpoints that don't belong to push subscription management.

  GET /proactive/voice         → Jarvis-style spoken briefing of pending events (audio)
  GET /proactive/voice/script  → the same briefing as text (captions / debug)
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from briefly_api.auth.deps import get_current_user
from briefly_api.config import Settings, get_settings
from briefly_api.db.models import User
from briefly_api.services.voice_briefing import synthesize_proactive_voice

log = logging.getLogger(__name__)

router = APIRouter(prefix="/proactive", tags=["proactive"])


@router.get("/voice")
async def proactive_voice(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Return a spoken proactive briefing for the current user's pending events."""
    if not settings.proactive_voice_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Proactive voice is not enabled.",
        )
    result = await synthesize_proactive_voice(user.id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No voice briefing available.",
        )
    script, audio, content_type = result
    return Response(
        content=audio,
        media_type=content_type,
        headers={
            "Cache-Control": "no-store",
            # Surface the script so the client can show captions without a 2nd call.
            "X-Briefly-Voice-Script": script.replace("\n", " ")[:480],
        },
    )


@router.get("/voice/script")
async def proactive_voice_script(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Text-only version of the proactive voice briefing (captions / debug)."""
    from briefly_api.db.engine import SessionLocal
    from briefly_api.agents.proactive.proactive_surfacing import get_for_api
    from briefly_api.services.voice_briefing import build_voice_script

    async with SessionLocal() as session:
        events = await get_for_api(session, user.id)

    first_name = (user.name or "").strip().split(" ")[0] or None if user.name else None
    script = await build_voice_script(events, first_name)
    return {"script": script, "event_count": len(events)}
