"""
briefly_api/stt/adapter.py

Provider-agnostic speech-to-text adapter.
Switch provider + model entirely from .env — zero code changes.

Supported providers:
  groq   → whisper-large-v3 (fast, cheap — recommended default)
  openai → whisper-1
"""
from __future__ import annotations

import logging

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from briefly_api.config import Settings, get_settings

log = logging.getLogger(__name__)


class STTAdapter:
    """Single interface for speech-to-text providers."""

    def __init__(self, settings: Settings | None = None):
        self._s = settings or get_settings()

    async def transcribe(
        self,
        audio_bytes: bytes,
        *,
        filename: str = "recording.webm",
        content_type: str = "audio/webm",
        language: str | None = None,
    ) -> str:
        """
        Transcribe audio bytes to plain text.

        Args:
            audio_bytes: Raw audio file bytes (webm, wav, mp3, m4a, etc.)
            filename:    Filename hint for the provider
            content_type: MIME type of the audio
            language:    Optional ISO-639-1 language code (e.g. "en")
        """
        provider = self._s.stt_provider
        model = self._s.stt_model

        log.debug("STT call: provider=%s model=%s bytes=%d", provider, model, len(audio_bytes))

        if provider == "groq":
            return await self._groq(audio_bytes, filename, content_type, model, language)
        if provider == "openai":
            return await self._openai(audio_bytes, filename, content_type, model, language)
        raise ValueError(f"Unknown STT provider: {provider}")

    @retry(
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=20),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _groq(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        model: str,
        language: str | None,
    ) -> str:
        if not self._s.groq_api_key:
            raise RuntimeError("GROQ_API_KEY not set (required for STT provider=groq)")

        data: dict[str, str] = {"model": model, "response_format": "text"}
        if language:
            data["language"] = language

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self._s.groq_api_key}"},
                data=data,
                files={"file": (filename, audio_bytes, content_type)},
            )
            resp.raise_for_status()
            return resp.text.strip()

    @retry(
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=20),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _openai(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        model: str,
        language: str | None,
    ) -> str:
        if not self._s.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY not set (required for STT provider=openai)")

        data: dict[str, str] = {"model": model, "response_format": "text"}
        if language:
            data["language"] = language

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self._s.openai_api_key}"},
                data=data,
                files={"file": (filename, audio_bytes, content_type)},
            )
            resp.raise_for_status()
            return resp.text.strip()


def get_stt_adapter(settings: Settings | None = None) -> STTAdapter:
    return STTAdapter(settings or get_settings())
