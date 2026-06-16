"""Tests for the self-hosted (openai_compatible) STT backend selection."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from briefly_api.stt.adapter import STTAdapter


def _settings(**over):
    base = dict(
        speech_to_text_provider="openai_compatible",
        stt_model="Systran/faster-whisper-large-v3",
        stt_base_url="http://localhost:8000/v1",
        stt_api_key="",
        openai_api_key="",
    )
    base.update(over)
    return SimpleNamespace(**base)


def test_openai_compatible_routes_to_self_hosted_base_url():
    a = STTAdapter(_settings())
    captured = {}

    async def fake_openai(audio, filename, content_type, model, language, prompt, *, base_url=None, api_key=None):
        captured["base_url"] = base_url
        captured["api_key"] = api_key
        captured["model"] = model
        return "transcribed text"

    a._openai = fake_openai  # type: ignore[assignment]
    out = asyncio.run(a.transcribe(b"audio", content_type="audio/wav", filename="r.wav", context_prompt="hint"))
    assert out == "transcribed text"
    assert captured["base_url"] == "http://localhost:8000/v1"
    assert captured["api_key"] == "no-key"   # defaulted for keyless self-hosted servers
    assert captured["model"] == "Systran/faster-whisper-large-v3"


def test_openai_compatible_requires_base_url():
    a = STTAdapter(_settings(stt_base_url=""))
    with pytest.raises(RuntimeError):
        asyncio.run(a.transcribe(b"audio", content_type="audio/wav", filename="r.wav", context_prompt="hint"))


def test_unknown_provider_raises():
    a = STTAdapter(_settings(speech_to_text_provider="bogus"))
    with pytest.raises(ValueError):
        asyncio.run(a.transcribe(b"audio", content_type="audio/wav", filename="r.wav", context_prompt="hint"))
