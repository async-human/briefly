"""Voice persona config for the orb — single source of TTS voice identity."""
from __future__ import annotations

from briefly_api.config import Settings, get_settings
from briefly_api.tts.adapter import get_tts_adapter


def orb_voice_config(settings: Settings | None = None) -> dict:
    s = settings or get_settings()
    tts = get_tts_adapter(s)
    return {
        "voice": s.tts_voice,
        "provider": s.tts_provider,
        "format": s.tts_format,
        "enabled": tts.enabled,
        "content_type": tts.content_type() if tts.enabled else None,
        "single_request_max_chars": s.orb_tts_single_request_max_chars,
    }
