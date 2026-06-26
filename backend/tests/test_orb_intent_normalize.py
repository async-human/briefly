"""Tests for post-LLM intent normalization."""
from __future__ import annotations

import asyncio

from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_session import OrbSessionState


def test_emails_from_briefly_coerced_from_ask_briefly(mock_intent):
    mock_intent(kind="ask_briefly", reason="gmail_inbox")
    decision = asyncio.run(
        classify_orb_intent("So any emails from, briefly?", thread_message_count=2)
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "gmail_search"


def test_gmail_agent_coerced_to_direct_search(mock_intent):
    mock_intent(
        kind="agent",
        tools=["gmail_search", "gmail_recent"],
        reason="goal_resume",
    )
    decision = asyncio.run(
        classify_orb_intent(
            "Now I want to know if there are any emails from Mitralabs.",
            thread_message_count=3,
        )
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "gmail_search"


def test_false_goal_resume_coerced_to_gmail_search(mock_intent):
    mock_intent(kind="agent", tools=["gmail_recent"], reason="goal_resume")
    session = OrbSessionState(
        session_id="s1",
        user_id="u1",
        active_goal={"status": "active", "objective": "old task", "history": []},
    )
    decision = asyncio.run(
        classify_orb_intent(
            "Yes. I do confirm. Any emails from Mitralabs?",
            session=session,
            session_has_prior_turn=True,
        )
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "gmail_search"
    assert session.active_goal is None
