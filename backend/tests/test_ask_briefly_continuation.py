"""Tests for vague follow-up / continuation context in ask_briefly."""
from __future__ import annotations

import asyncio

from briefly_api.services.ask_briefly import (
    _prior_user_question,
    _resolve_retrieval_query,
    is_vague_continuation,
)
from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_session import OrbSessionState


def test_is_vague_continuation_detects_more_details():
    assert is_vague_continuation("can you provide me more details")
    assert is_vague_continuation("tell me more")
    assert not is_vague_continuation("what is quantum computing")


def test_resolve_retrieval_query_expands_with_prior_question():
    class _Thread:
        messages = [
            {"role": "user", "content": "Tell me about quantum computing"},
            {"role": "assistant", "content": "Quantum computing uses qubits..."},
        ]

    q = _resolve_retrieval_query("can you provide more details", _Thread())
    assert "quantum computing" in q.lower()
    assert "more details" in q.lower()


def test_prior_user_question_skips_empty():
    history = [
        {"role": "assistant", "content": "Hi"},
        {"role": "user", "content": "ok"},
    ]
    assert _prior_user_question(history) == ""


def test_continuation_routes_to_ask_briefly_with_session(mock_intent):
    mock_intent(kind="ask_briefly", reason="continuation_followup")
    session = OrbSessionState(
        session_id="s1",
        user_id="u1",
        last_tool="ask_briefly",
        last_transcript="Tell me about quantum computing",
        last_answer="Quantum computing uses qubits.",
        route_kind="ask_briefly",
    )
    decision = asyncio.run(
        classify_orb_intent(
            "can you provide more details",
            thread_message_count=2,
            session=session,
            session_has_prior_turn=True,
        )
    )
    assert decision.kind == "ask_briefly"
    assert decision.reason == "continuation_followup"
