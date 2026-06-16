"""Tests for the provider-agnostic TTS adapter."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from briefly_api.tts.adapter import TTSAdapter, TTSError


def _settings(**over):
    base = dict(
        tts_provider="openai_compatible",
        tts_model="kokoro",
        tts_voice="af_heart",
        tts_format="mp3",
        tts_base_url="http://localhost:8880/v1",
        tts_api_key="",
        openai_api_key="",
    )
    base.update(over)
    return SimpleNamespace(**base)


def test_enabled_flag():
    assert TTSAdapter(_settings(tts_provider="openai_compatible")).enabled is True
    assert TTSAdapter(_settings(tts_provider="disabled")).enabled is False


def test_resolve_openai_compatible_targets_self_hosted():
    a = TTSAdapter(_settings(tts_base_url="http://localhost:8880/v1", tts_api_key="secret"))
    endpoint, key, ctype = a._resolve()
    assert endpoint == "http://localhost:8880/v1/audio/speech"
    assert key == "secret"
    assert ctype == "audio/mpeg"


def test_resolve_openai_compatible_defaults_key_when_none():
    a = TTSAdapter(_settings(tts_api_key=""))
    _, key, _ = a._resolve()
    assert key == "no-key"  # self-hosted servers usually accept any/none


def test_resolve_openai_compatible_requires_base_url():
    a = TTSAdapter(_settings(tts_base_url=""))
    with pytest.raises(TTSError):
        a._resolve()


def test_resolve_openai_cloud():
    a = TTSAdapter(_settings(tts_provider="openai", openai_api_key="sk-x"))
    endpoint, key, _ = a._resolve()
    assert endpoint == "https://api.openai.com/v1/audio/speech"
    assert key == "sk-x"


def test_resolve_openai_cloud_requires_key():
    a = TTSAdapter(_settings(tts_provider="openai", openai_api_key=""))
    with pytest.raises(TTSError):
        a._resolve()


def test_payload_shape():
    a = TTSAdapter(_settings())
    p = a._payload("hello", voice=None)
    assert p == {"model": "kokoro", "input": "hello", "voice": "af_heart", "response_format": "mp3"}
    # explicit voice override wins
    assert a._payload("hi", voice="bf_emma")["voice"] == "bf_emma"


def test_content_type_mapping():
    assert TTSAdapter(_settings(tts_format="wav")).content_type() == "audio/wav"
    assert TTSAdapter(_settings(tts_format="opus")).content_type() == "audio/opus"


def test_synthesize_empty_text_returns_empty():
    assert asyncio.run(TTSAdapter(_settings()).synthesize("   ")) == b""


def test_synthesize_posts_to_endpoint(monkeypatch):
    captured = {}

    class _Resp:
        status_code = 200
        content = b"AUDIO"

        def raise_for_status(self):
            pass

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            captured["url"] = url
            captured["json"] = json
            captured["auth"] = headers["Authorization"]
            return _Resp()

    import briefly_api.tts.adapter as mod
    monkeypatch.setattr(mod.httpx, "AsyncClient", _Client)

    out = asyncio.run(TTSAdapter(_settings(tts_api_key="k")).synthesize("read me"))
    assert out == b"AUDIO"
    assert captured["url"] == "http://localhost:8880/v1/audio/speech"
    assert captured["json"]["input"] == "read me"
    assert captured["auth"] == "Bearer k"


# ── In-process (local, no Docker) provider ──────────────────────────────────────

def test_local_provider_enabled_and_wav_content_type():
    a = TTSAdapter(_settings(tts_provider="local"))
    assert a.enabled is True
    assert a.content_type() == "audio/wav"


def test_local_synthesize_calls_kokoro(monkeypatch):
    import briefly_api.tts.adapter as mod
    captured = {}

    def fake_kokoro(text, voice, lang):
        captured["text"] = text
        captured["voice"] = voice
        captured["lang"] = lang
        return b"WAVDATA"

    monkeypatch.setattr(mod, "_kokoro_wav_bytes", fake_kokoro)
    out = asyncio.run(TTSAdapter(_settings(tts_provider="local", tts_voice="af_heart", tts_lang_code="a")).synthesize("hi orb"))
    assert out == b"WAVDATA"
    assert captured == {"text": "hi orb", "voice": "af_heart", "lang": "a"}


def test_local_stream_emits_full_clip(monkeypatch):
    import briefly_api.tts.adapter as mod
    monkeypatch.setattr(mod, "_kokoro_wav_bytes", lambda *a: b"CLIP")

    async def collect():
        return [c async for c in TTSAdapter(_settings(tts_provider="local")).synthesize_stream("hello")]

    assert asyncio.run(collect()) == [b"CLIP"]
