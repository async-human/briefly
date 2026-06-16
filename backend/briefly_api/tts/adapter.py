"""
briefly_api/tts/adapter.py

Provider-agnostic text-to-speech adapter. Switch provider/model/voice entirely
from .env — zero code changes, mirroring the LLM and STT adapters.

Providers (TTS_PROVIDER):
  openai_compatible → self-hosted SOTA open models behind an OpenAI-compatible
                      /v1/audio/speech server. Default targets Kokoro-FastAPI
                      (Kokoro-82M, Apache-2.0 — fast, CPU-friendly, commercial-OK).
                      Set TTS_BASE_URL (e.g. http://localhost:8880/v1).
  openai            → OpenAI cloud TTS (OPENAI_API_KEY).
  disabled          → no streaming TTS; callers fall back to the AudioAgent path.

Why OpenAI-compatible: the best free/open TTS servers (Kokoro-FastAPI, etc.)
expose the same /v1/audio/speech contract, so swapping the open model for a
cloud one — or vice versa — is a config change, never a code change.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from briefly_api.config import Settings, get_settings

log = logging.getLogger(__name__)

_OPENAI_BASE = "https://api.openai.com/v1"


class TTSError(RuntimeError):
    pass


class TTSAdapter:
    """Single interface for text-to-speech providers."""

    def __init__(self, settings: Settings | None = None):
        self._s = settings or get_settings()

    @property
    def enabled(self) -> bool:
        return self._s.tts_provider != "disabled"

    def _resolve(self) -> tuple[str, str, str]:
        """Return (endpoint, api_key, content_type) for the configured provider."""
        provider = self._s.tts_provider
        fmt = (self._s.tts_format or "mp3").lower()
        content_type = _AUDIO_CONTENT_TYPES.get(fmt, "application/octet-stream")

        if provider == "openai":
            if not self._s.openai_api_key:
                raise TTSError("OPENAI_API_KEY not set (required for TTS_PROVIDER=openai)")
            return f"{_OPENAI_BASE}/audio/speech", self._s.openai_api_key, content_type

        if provider == "openai_compatible":
            base = (self._s.tts_base_url or "").rstrip("/")
            if not base:
                raise TTSError("TTS_BASE_URL not set (required for TTS_PROVIDER=openai_compatible)")
            return f"{base}/audio/speech", (self._s.tts_api_key or "no-key"), content_type

        raise TTSError(f"TTS is disabled or unknown provider: {provider}")

    def _payload(self, text: str, voice: str | None) -> dict:
        return {
            "model": self._s.tts_model,
            "input": text,
            "voice": voice or self._s.tts_voice,
            "response_format": (self._s.tts_format or "mp3").lower(),
        }

    @retry(
        retry=retry_if_exception_type((httpx.TimeoutException,)),
        wait=wait_exponential(multiplier=1, min=2, max=20),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def synthesize(self, text: str, *, voice: str | None = None) -> bytes:
        """Synthesize the full clip and return raw audio bytes."""
        text = (text or "").strip()
        if not text:
            return b""
        if self._s.tts_provider == "local":
            return await self._local_synthesize(text, voice)
        endpoint, api_key, _ = self._resolve()
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {api_key}"},
                json=self._payload(text, voice),
            )
            if resp.status_code >= 400:
                log.error("TTS error %s: %s", resp.status_code, resp.text[:500])
            resp.raise_for_status()
            return resp.content

    async def _local_synthesize(self, text: str, voice: str | None) -> bytes:
        """Synthesize in-process with Kokoro — no Docker, no server. Returns WAV."""
        voice = voice or self._s.tts_voice
        lang = getattr(self._s, "tts_lang_code", "a")
        return await asyncio.to_thread(_kokoro_wav_bytes, text, voice, lang)

    async def synthesize_stream(
        self, text: str, *, voice: str | None = None
    ) -> AsyncIterator[bytes]:
        """
        Stream audio chunks as they're produced — the low-latency path for the
        voice orb so playback can start before synthesis finishes.
        """
        text = (text or "").strip()
        if not text:
            return
        if self._s.tts_provider == "local":
            # In-process synthesis isn't chunk-streamed; emit the full clip once.
            data = await self._local_synthesize(text, voice)
            if data:
                yield data
            return
        endpoint, api_key, _ = self._resolve()
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                endpoint,
                headers={"Authorization": f"Bearer {api_key}"},
                json=self._payload(text, voice),
            ) as resp:
                if resp.status_code >= 400:
                    body = await resp.aread()
                    log.error("TTS stream error %s: %s", resp.status_code, body[:500])
                    resp.raise_for_status()
                async for chunk in resp.aiter_bytes():
                    if chunk:
                        yield chunk

    def content_type(self) -> str:
        if self._s.tts_provider == "local":
            return "audio/wav"  # in-process Kokoro path emits WAV
        return _AUDIO_CONTENT_TYPES.get((self._s.tts_format or "mp3").lower(), "application/octet-stream")


_AUDIO_CONTENT_TYPES = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "opus": "audio/opus",
    "pcm": "audio/L16",
    "flac": "audio/flac",
    "aac": "audio/aac",
}


# Cache Kokoro pipelines per language so weights load once (provider=local).
_KOKORO_PIPELINES: dict[str, object] = {}
_KOKORO_SAMPLE_RATE = 24000


def _kokoro_wav_bytes(text: str, voice: str, lang_code: str) -> bytes:
    """Run Kokoro in-process and return WAV bytes. Optional deps: kokoro, soundfile, numpy."""
    import io

    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    pipeline = _KOKORO_PIPELINES.get(lang_code)
    if pipeline is None:
        pipeline = KPipeline(lang_code=lang_code)
        _KOKORO_PIPELINES[lang_code] = pipeline

    chunks = [audio for _gs, _ps, audio in pipeline(text, voice=voice)]
    if not chunks:
        return b""
    full = np.concatenate(chunks)
    buf = io.BytesIO()
    sf.write(buf, full, _KOKORO_SAMPLE_RATE, format="WAV")
    return buf.getvalue()


def get_tts_adapter(settings: Settings | None = None) -> TTSAdapter:
    return TTSAdapter(settings)
