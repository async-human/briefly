"""Tests for human-like voice interaction helpers."""
from __future__ import annotations

from briefly_api.services.orb_router import RouteDecision
from briefly_api.services.orb_voice_interaction import (
    detect_clarification,
    merge_clarification_follow_up,
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


def test_no_clarify_on_compound_research_report():
    decision = RouteDecision(kind="agent", reason="compound_goal")
    msg = detect_clarification(
        "Can you research on quantum computing and write my report?",
        decision,
    )
    assert msg is None


def test_merge_clarification_follow_up():
    from briefly_api.services.orb_session import OrbSessionState

    session = OrbSessionState(
        session_id="s1",
        user_id="u1",
        route_kind="clarify",
        pending_user_goal="Basically how quantum computing is and what's the curre",
    )
    merged = merge_clarification_follow_up("Quantum computing.", session)
    assert "quantum computing" in merged.lower()
    assert session.pending_user_goal is None

