"""Tests for human-like voice interaction helpers."""
from __future__ import annotations

from briefly_api.services.orb_router import RouteDecision
from briefly_api.services.orb_voice_interaction import (
    detect_clarification,
    spoken_acknowledgment,
)


def test_detect_incomplete_trailing_and():
    decision = RouteDecision(kind="ask_briefly", reason="corpus_library")
    msg = detect_clarification(
        "I would like to know all the articles that we have on generative ai and",
        decision,
    )
    assert msg is not None
    assert "finish" in msg.lower()


def test_spoken_ack_corpus_library():
    decision = RouteDecision(kind="ask_briefly", reason="corpus_library")
    ack = spoken_acknowledgment("articles about generative ai", decision)
    assert ack is not None
    assert "library" in ack.lower() or "generative" in ack.lower()


def test_detect_email_missing_recipient():
    decision = RouteDecision(kind="agent", reason="compound_goal")
    msg = detect_clarification("draft an email about the report", decision)
    assert msg is not None
    assert "who" in msg.lower()


def test_no_clarify_on_complete_query():
    decision = RouteDecision(kind="direct", reason="regex_single")
    msg = detect_clarification("what's on my calendar tomorrow", decision)
    assert msg is None
