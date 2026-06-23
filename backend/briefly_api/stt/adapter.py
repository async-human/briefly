"""
briefly_api/stt/adapter.py

Provider-agnostic speech-to-text adapter.
Switch provider + model entirely from .env — zero code changes.

Supported providers (SPEECH_TO_TEXT_PROVIDER / STT_PROVIDER):
  openai   → gpt-4o-transcribe (best accuracy — recommended)
  deepgram → nova-2, nova-3, etc.
  groq     → whisper-large-v3 (fast, budget option)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from briefly_api.config import Settings, get_settings
from briefly_api.stt.audio_utils import convert_to_wav, input_suffix_for, normalize_upload
from briefly_api.stt.prompts import build_transcription_prompt

log = logging.getLogger(__name__)

_DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"

_KEYTERM_STOPWORDS = frozenset({
    "a", "an", "and", "are", "as", "at", "be", "briefly", "by", "for", "from",
    "ignore", "in", "is", "it", "of", "on", "only", "or", "primary", "speaker",
    "that", "the", "this", "to", "transcribe", "with", "your",
})


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
        provider = self._s.speech_to_text_provider
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
        if provider == "openai_compatible":
            # Self-hosted SOTA open models (faster-whisper-server / Speaches / Parakeet)
            # exposing OpenAI's /v1/audio/transcriptions API.
            base = (self._s.stt_base_url or "").rstrip("/")
            if not base:
                raise RuntimeError("STT_BASE_URL not set (required for provider=openai_compatible)")
            return await self._openai(
                audio_bytes, filename, content_type, model, language, prompt,
                base_url=base,
                api_key=self._s.stt_api_key or "no-key",
            )
        if provider == "deepgram":
            return await self._deepgram(audio_bytes, filename, content_type, model, language, prompt)
        if provider == "local":
            return await self._local(audio_bytes, filename, model, language)
        raise ValueError(f"Unknown STT provider: {provider}")

    async def _local(
        self,
        audio_bytes: bytes,
        filename: str,
        model: str,
        language: str | None,
    ) -> str:
        """Transcribe in-process with faster-whisper — no Docker, no server."""
        device = getattr(self._s, "stt_device", "cpu")
        compute_type = getattr(self._s, "stt_compute_type", "int8")

        def _run() -> str:
            wm = _get_faster_whisper_model(model, device, compute_type)
            suffix = "." + filename.rsplit(".", 1)[-1] if "." in filename else ".webm"
            fd, path = tempfile.mkstemp(suffix=suffix)
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(audio_bytes)
                segments, _info = wm.transcribe(path, language=language or None, beam_size=5)
                # Whisper segments carry their own leading spaces; normalize whitespace.
                return " ".join("".join(seg.text for seg in segments).split())
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass

        return await asyncio.to_thread(_run)

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
        *,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> str:
        # base_url=None → OpenAI cloud; otherwise an OpenAI-compatible self-hosted server.
        key = api_key if api_key is not None else self._s.openai_api_key
        if base_url is None and not key:
            raise RuntimeError("OPENAI_API_KEY not set (required for STT provider=openai)")
        endpoint = f"{base_url}/audio/transcriptions" if base_url else "https://api.openai.com/v1/audio/transcriptions"

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
            endpoint,
            key,
            data,
            upload_bytes,
            upload_name,
            upload_type,
        )

    @retry(
        retry=retry_if_exception_type((httpx.TimeoutException,)),
        wait=wait_exponential(multiplier=1, min=2, max=20),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _deepgram(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        model: str,
        language: str | None,
        prompt: str,
    ) -> str:
        if not self._s.deepgram_api_key:
            raise RuntimeError(
                "DEEPGRAM_API_KEY not set (required for SPEECH_TO_TEXT_PROVIDER=deepgram)",
            )

        suffix = input_suffix_for(content_type, filename)
        ct = (content_type or "").split(";")[0].strip().lower()

        browser_cts = {"audio/webm", "video/webm", "audio/mp4", "audio/m4a", "audio/ogg", "audio/opus"}
        browser_suffixes = {".webm", ".m4a", ".mp4", ".ogg", ".opus"}
        if ct in browser_cts or suffix in browser_suffixes:
            wav_bytes = convert_to_wav(audio_bytes, input_suffix=suffix)
            if wav_bytes:
                return await self._deepgram_request(
                    wav_bytes, "recording.wav", "audio/wav", model, language, prompt,
                )

        try:
            return await self._deepgram_request(
                audio_bytes, filename, content_type, model, language, prompt,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 400:
                raise
            wav_bytes = convert_to_wav(audio_bytes, input_suffix=suffix)
            if wav_bytes:
                log.info("STT: Deepgram rejected raw audio, retrying with ffmpeg WAV")
                return await self._deepgram_request(
                    wav_bytes, "recording.wav", "audio/wav", model, language, prompt,
                )
            raise

    async def _deepgram_request(
        self,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        model: str,
        language: str | None,
        prompt: str,
    ) -> str:
        params: list[tuple[str, str]] = [
            ("model", model),
            ("smart_format", "true"),
            ("punctuate", "true"),
            ("language", language or "en"),
        ]
        for term in _deepgram_keyterms_from_prompt(prompt):
            params.append(("keyterm", term))

        headers = {
            "Authorization": f"Token {self._s.deepgram_api_key}",
            "Content-Type": content_type or "application/octet-stream",
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                _DEEPGRAM_URL,
                params=params,
                content=audio_bytes,
                headers=headers,
            )
            if resp.status_code >= 400:
                log.error("STT Deepgram error %s: %s", resp.status_code, resp.text[:800])
            resp.raise_for_status()
            return _parse_deepgram_transcript(resp.json())

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


def _parse_deepgram_transcript(body: object) -> str:
    if not isinstance(body, dict):
        return ""
    try:
        channels = body["results"]["channels"]
        alternatives = channels[0]["alternatives"]
        return str(alternatives[0].get("transcript") or "").strip()
    except (KeyError, IndexError, TypeError):
        log.warning("STT: unexpected Deepgram response shape: %s", str(body)[:400])
        return ""


def _deepgram_keyterms_from_prompt(prompt: str, *, limit: int = 12) -> list[str]:
    """Extract vocabulary hints for Deepgram keyterm boosting."""
    words = re.findall(r"\b[A-Za-z][A-Za-z0-9_-]{2,}\b", prompt)
    seen: set[str] = set()
    terms: list[str] = []
    for word in words:
        key = word.lower()
        if key in _KEYTERM_STOPWORDS or key in seen:
            continue
        seen.add(key)
        terms.append(word)
        if len(terms) >= limit:
            break
    return terms


# Cache the loaded model so we don't reload weights on every request.
_FW_MODEL = None
_FW_KEY: tuple[str, str, str] | None = None


def _get_faster_whisper_model(model: str, device: str, compute_type: str):
    """Lazily load + cache a faster-whisper model (provider=local)."""
    global _FW_MODEL, _FW_KEY
    key = (model or "large-v3", device, compute_type)
    if _FW_MODEL is None or _FW_KEY != key:
        from faster_whisper import WhisperModel  # optional dep: pip install faster-whisper

        _FW_MODEL = WhisperModel(key[0], device=device, compute_type=compute_type)
        _FW_KEY = key
    return _FW_MODEL


def get_stt_adapter(settings: Settings | None = None) -> STTAdapter:
    return STTAdapter(settings or get_settings())
