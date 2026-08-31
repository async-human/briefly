"""Tests for feedback learned messages."""
from __future__ import annotations

from briefly_api.services.feedback_learned import build_learned_message


def test_saved_message():
    msg = build_learned_message("saved", source_name="TechCrunch", headline="OpenAI ships GPT-5")
    assert msg and "tomorrow" in msg.lower()


def test_disliked_message():
    msg = build_learned_message("disliked", source_name="CoinDesk", headline="Bitcoin hits new high")
    assert msg and "less" in msg.lower()


def test_clicked_returns_none():
    assert build_learned_message("clicked", source_name="X", headline="Y") is None


def test_decision_loop_messages():
    assert "decision" in (build_learned_message("decision_changed", source_name=None, headline="X") or "").lower()
    assert "action" in (build_learned_message("acted", source_name=None, headline="X") or "").lower()
    assert "tracking" in (build_learned_message("tracked", source_name=None, headline="Anthropic") or "").lower()

