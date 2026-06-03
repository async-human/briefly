"""
briefly_api/stt/adapter.py

Provider-agnostic speech-to-text adapter.
Switch provider + model entirely from .env — zero code changes.

Supported providers:
  openai → gpt-4o-transcribe (best accuracy — recommended)
  openai → gpt-4o-mini-transcribe, whisper-1
  groq   → whisper-large-v3 (fast, budget option)
"""
from __future__ import annotations

import json
import logging

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from briefly_api.config import Settings, get_settings
from briefly_api.stt.audio_utils import convert_to_wav, normalize_upload
from briefly_api.stt.prompts import build_transcription_prompt

log = logging.getLogger(__name__)


def _is_gpt4o_transcribe(model: str) -> bool:
    return model.startswith("gpt-4o")


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
        context_prompt: str | None = None,
    ) -> str:
        """
        Transcribe audio bytes to plain text.

        Args:
            context_prompt: Optional vocabulary/style hint (user interests, tech terms).
        """
        provider = self._s.stt_provider
        model = self._s.stt_model
        content_type, filename = normalize_upload(content_type, filename)
        prompt = (context_prompt or build_transcription_prompt()).strip()

        log.debug(
            "STT call: provider=%s model=%s bytes=%d type=%s file=%s",
            provider, model, len(audio_bytes), content_type, filename,
        )

        if provider == "groq":
            return await self._groq(audio_bytes, filename, content_type, model, language, prompt)
        if provider == "openai":
            return await self._openai(audio_bytes, filename, content_type, model, language, prompt)
        raise ValueError(f"Unknown STT provider: {provider}")

    async def _groq(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        model: str,
        language: str | None,
        prompt: str,
    ) -> str:
        suffix = "." + filename.rsplit(".", 1)[-1] if "." in filename else ".webm"
        ct = (content_type or "").split(";")[0].strip().lower()

        if ct in {"audio/webm", "video/webm"} or suffix == ".webm":
            wav_bytes = convert_to_wav(audio_bytes, input_suffix=suffix)
            if wav_bytes:
                try:
                    return await self._groq_request(
                        wav_bytes, "recording.wav", "audio/wav", model, language, prompt,
                    )
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code != 400:
                        raise
                    log.info("STT: Groq rejected ffmpeg WAV, retrying raw WebM")

        try:
            return await self._groq_request(
                audio_bytes, filename, content_type, model, language, prompt,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 400:
                raise
            wav_bytes = convert_to_wav(audio_bytes, input_suffix=suffix)
            if wav_bytes:
                log.info("STT: retrying Groq transcription with ffmpeg WAV conversion")
                return await self._groq_request(
                    wav_bytes, "recording.wav", "audio/wav", model, language, prompt,
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
        prompt: str,
    ) -> str:
        if not self._s.groq_api_key:
            raise RuntimeError("GROQ_API_KEY not set (required for STT provider=groq)")

        data: dict[str, str] = {
            "model": model,
            "response_format": "json",
            "language": language or "en",
            "prompt": prompt,
            "temperature": "0",
        }

        return await self._post_transcription(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            self._s.groq_api_key,
            data,
            audio_bytes,
            filename,
            content_type,
        )

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
        prompt: str,
    ) -> str:
        if not self._s.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY not set (required for STT provider=openai)")

        data: dict[str, str] = {
            "model": model,
            "response_format": "json",
            "prompt": prompt,
        }
        if language:
            data["language"] = language
        # gpt-4o-transcribe models reject temperature; Whisper accepts it.
        if not _is_gpt4o_transcribe(model):
            data["temperature"] = "0"

        suffix = "." + filename.rsplit(".", 1)[-1] if "." in filename else ".webm"
        ct = (content_type or "").split(";")[0].strip().lower()
        upload_bytes = audio_bytes
        upload_name = filename
        upload_type = content_type

        if ct in {"audio/webm", "video/webm"} or suffix == ".webm":
            wav_bytes = convert_to_wav(audio_bytes, input_suffix=suffix)
            if wav_bytes:
                upload_bytes = wav_bytes
                upload_name = "recording.wav"
                upload_type = "audio/wav"

        return await self._post_transcription(
            "https://api.openai.com/v1/audio/transcriptions",
            self._s.openai_api_key,
            data,
            upload_bytes,
            upload_name,
            upload_type,
        )

    async def _post_transcription(
        self,
        url: str,
        api_key: str,
        data: dict[str, str],
        audio_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> str:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files={"file": (filename, audio_bytes, content_type)},
            )
            if resp.status_code >= 400:
                log.error("STT error %s: %s", resp.status_code, resp.text[:800])
            resp.raise_for_status()
            body = resp.text.strip()
            if body.startswith("{"):
                parsed = json.loads(body)
                return str(parsed.get("text") or "").strip()
            return body


def get_stt_adapter(settings: Settings | None = None) -> STTAdapter:
    return STTAdapter(settings or get_settings())
