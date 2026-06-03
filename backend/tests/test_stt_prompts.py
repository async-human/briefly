"""Tests for STT prompt building."""
from __future__ import annotations

from briefly_api.stt.prompts import build_transcription_prompt


def test_build_prompt_includes_user_interests():
    prompt = build_transcription_prompt(
        role="Founder",
        interests=["RAG pipelines", "product-market fit"],
    )
    assert "RAG pipelines" in prompt
    assert "product-market fit" in prompt
    assert "Expected vocabulary" in prompt


def test_build_prompt_has_default_tech_vocab():
    prompt = build_transcription_prompt()
    assert "LLM" in prompt
    assert len(prompt) <= 900
