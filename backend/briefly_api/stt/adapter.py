"""
briefly_api/stt/adapter.py

Provider-agnostic speech-to-text adapter.
Switch provider + model entirely from .env — zero code changes.

Supported providers:
  groq   → whisper-large-v3 (fast, cheap — recommended default)
  openai → whisper-1
"""
from __future__ import annotations

import json
import logging

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from briefly_api.config import Settings, get_settings
from briefly_api.stt.audio_utils import convert_to_wav, normalize_upload

log = logging.getLogger(__name__)

_STT_PROMPT = (
    "Transcribe spoken English accurately with proper punctuation, capitalization, "
    "paragraph breaks, and bullet points when the speaker lists multiple items. "
    "Ignore background noise, hum, keyboard clicks, and room echo — transcribe only "
    "the primary speaker's words."
)


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
        content_type, filename = normalize_upload(content_type, filename)

        log.debug(
            "STT call: provider=%s model=%s bytes=%d type=%s file=%s",
            provider, model, len(audio_bytes), content_type, filename,
        )

        if provider == "groq":
            return await self._groq(audio_bytes, filename, content_type, model, language)
        if provider == "openai":
            return await self._openai(audio_bytes, filename, content_type, model, language)
        raise ValueError(f"Unknown STT provider: {provider}")

    async def _groq(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        model: str,
        language: str | None,
    ) -> str:
        suffix = "." + filename.rsplit(".", 1)[-1] if "." in filename else ".webm"
        ct = (content_type or "").split(";")[0].strip().lower()

        # Browser WebM (especially in-progress recordings) is more reliable via ffmpeg WAV.
        if ct in {"audio/webm", "video/webm"} or suffix == ".webm":
            wav_bytes = convert_to_wav(audio_bytes, input_suffix=suffix)
            if wav_bytes:
                try:
                    return await self._groq_request(
                        wav_bytes, "recording.wav", "audio/wav", model, language,
                    )
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code != 400:
                        raise
                    log.info("STT: Groq rejected ffmpeg WAV, retrying raw WebM")

        try:
            return await self._groq_request(
                audio_bytes, filename, content_type, model, language,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 400:
                raise
            wav_bytes = convert_to_wav(audio_bytes, input_suffix=suffix)
            if wav_bytes:
                log.info("STT: retrying Groq transcription with ffmpeg WAV conversion")
                return await self._groq_request(
                    wav_bytes, "recording.wav", "audio/wav", model, language,
                )
            raise

    @retry(
        retry=retry_if_exception_type((httpx.TimeoutException,)),
        wait=wait_exponential(multiplier=1, min=2, max=20),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _groq_request(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        model: str,
        language: str | None,
    ) -> str:
        if not self._s.groq_api_key:
            raise RuntimeError("GROQ_API_KEY not set (required for STT provider=groq)")

        data: dict[str, str] = {
            "model": model,
            "response_format": "json",
            "language": language or "en",
            "prompt": _STT_PROMPT,
            "temperature": "0",
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self._s.groq_api_key}"},
                data=data,
                files={"file": (filename, audio_bytes, content_type)},
            )
            if resp.status_code >= 400:
                log.error(
                    "Groq STT error %s: %s",
                    resp.status_code,
                    resp.text[:800],
                )
            resp.raise_for_status()
            body = resp.text.strip()
            if body.startswith("{"):
                parsed = json.loads(body)
                return str(parsed.get("text") or "").strip()
            return body

    @retry(
        retry=retry_if_exception_type((httpx.TimeoutException,)),
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

        data: dict[str, str] = {
            "model": model,
            "response_format": "json",
            "prompt": _STT_PROMPT,
            "temperature": "0",
        }
        if language:
            data["language"] = language

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self._s.openai_api_key}"},
                data=data,
                files={"file": (filename, audio_bytes, content_type)},
            )
            if resp.status_code >= 400:
                log.error(
                    "OpenAI STT error %s: %s",
                    resp.status_code,
                    resp.text[:800],
                )
            resp.raise_for_status()
            body = resp.text.strip()
            if body.startswith("{"):
                parsed = json.loads(body)
                return str(parsed.get("text") or "").strip()
            return body


def get_stt_adapter(settings: Settings | None = None) -> STTAdapter:
    return STTAdapter(settings or get_settings())
