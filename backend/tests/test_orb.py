"""Tests for the voice-orb turn orchestration (STT → Ask Briefly)."""
from __future__ import annotations

import asyncio

import pytest

import briefly_api.services.orb as orb


def _patch_ask(monkeypatch, capture):
    async def fake_ask(db, user, message, *, thread_id=None, content_id=None):
        capture["message"] = message
        capture["thread_id_in"] = thread_id
        return {
            "thread_id": "t1",
            "assistant": {"content": "Here's what matters.", "citations": [{"ref": "S1"}]},
        }

    monkeypatch.setattr(orb, "ask_briefly", fake_ask)


def test_text_turn_goes_straight_to_ask(monkeypatch):
    cap = {}
    _patch_ask(monkeypatch, cap)
    out = asyncio.run(orb.run_orb_turn(db=None, user=object(), text="what's new in AI?"))
    assert cap["message"] == "what's new in AI?"
    assert out["transcript"] == "what's new in AI?"
    assert out["answer"] == "Here's what matters."
    assert out["thread_id"] == "t1"
    assert out["citations"] == [{"ref": "S1"}]


def test_audio_turn_transcribes_first(monkeypatch):
    cap = {}
    _patch_ask(monkeypatch, cap)

    class _STT:
        async def transcribe(self, audio_bytes, *, filename, content_type):
            cap["stt_bytes"] = audio_bytes
            return "  spoken question  "

    monkeypatch.setattr(orb, "get_stt_adapter", lambda *a, **k: _STT())
    out = asyncio.run(orb.run_orb_turn(db=None, user=object(), audio_bytes=b"AUDIO"))
    assert cap["stt_bytes"] == b"AUDIO"
    assert out["transcript"] == "spoken question"   # trimmed
    assert cap["message"] == "spoken question"       # transcript fed to the brain


def test_empty_input_raises(monkeypatch):
    _patch_ask(monkeypatch, {})
    with pytest.raises(ValueError):
        asyncio.run(orb.run_orb_turn(db=None, user=object(), text="   "))


def test_blank_transcription_raises(monkeypatch):
    _patch_ask(monkeypatch, {})

    class _STT:
        async def transcribe(self, audio_bytes, *, filename, content_type):
            return "   "

    monkeypatch.setattr(orb, "get_stt_adapter", lambda *a, **k: _STT())
    with pytest.raises(ValueError):
        asyncio.run(orb.run_orb_turn(db=None, user=object(), audio_bytes=b"x"))
