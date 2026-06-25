"""Tests for orb goal state and compound routing."""
from __future__ import annotations

import asyncio

from briefly_api.services.orb_goal import (
    agent_goal_text,
    classify_goal_routing,
    is_compound_goal,
    should_resume_goal,
    start_goal,
    sync_goal_from_result,
)
from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_session import OrbSessionState


def test_is_compound_goal_detects_multi_step():
    assert is_compound_goal("research this topic and then write a report")
    assert is_compound_goal("look up the weather and email me a summary")
    assert not is_compound_goal("what's the weather in Pune")


def test_goal_resume_after_confirmation():
    session = OrbSessionState(session_id="s1", user_id="u1")
    start_goal(session, "research AI and email me a summary")
    session.active_goal["status"] = "awaiting_confirm"
    session.active_goal["pending_tool"] = "send_email"
    assert should_resume_goal(session, "yes send it")
    decision = classify_goal_routing("yes send it", session, matched_tool_count=0)
    assert decision is not None
    assert decision.kind == "agent"
    assert decision.reason == "goal_resume_confirm"


def test_compound_routes_to_agent():
    session = OrbSessionState(session_id="s1", user_id="u1")
    decision = asyncio.run(
        classify_orb_intent(
            "research quantum computing and write me a report",
            session=session,
        )
    )
    assert decision.kind == "agent"
    assert decision.reason == "compound_goal"
    assert session.active_goal is not None
    assert session.active_goal["status"] == "active"


def test_agent_goal_text_includes_confirmation():
    session = OrbSessionState(session_id="s1", user_id="u1")
    start_goal(session, "draft and send the weekly report")
    session.active_goal["status"] = "awaiting_confirm"
    session.active_goal["pending_tool"] = "send_email"
    text = agent_goal_text(session, "yes go ahead")
    assert "USER CONFIRMED" in text
    assert "send_email" in text


def test_sync_goal_needs_confirmation():
    from briefly_api.agent.runtime import AgentStep

    session = OrbSessionState(session_id="s1", user_id="u1")
    start_goal(session, "email the report")
    steps = [
        AgentStep(1, "draft", "draft_email", {}, "draft ready", ok=True),
        AgentStep(2, "send", "send_email", {"to": "a@b.com"}, "blocked", ok=False),
    ]
    sync_goal_from_result(session, "email the report", steps=steps, stopped_reason="needs_confirmation")
    assert session.active_goal["status"] == "awaiting_confirm"
    assert session.active_goal["pending_tool"] == "send_email"
