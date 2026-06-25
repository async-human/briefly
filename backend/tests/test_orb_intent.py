"""Tests for orb intent routing (LLM router mocked)."""
from __future__ import annotations

import asyncio

from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_session import OrbSessionState


def test_thread_affinity_calendar_follow_up(mock_intent):
    mock_intent(kind="direct", tools=["calendar_upcoming"], reason="thread_affinity")
    session = OrbSessionState(
        session_id="s1",
        user_id="u1",
        last_tool="calendar_upcoming",
        last_transcript="what's on my calendar",
    )
    decision = asyncio.run(
        classify_orb_intent(
            "what about tomorrow",
            thread_message_count=2,
            session=session,
            session_has_prior_turn=True,
        )
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "calendar_upcoming"


def test_research_and_report_routes_to_compose_report(mock_intent):
    mock_intent(kind="direct", tools=["compose_report"], reason="research_report")
    decision = asyncio.run(
        classify_orb_intent(
            "Can you do some research on quantum computing and write me a report?",
            thread_message_count=0,
        )
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "compose_report"


def test_research_report_with_email_stays_agent(mock_intent):
    mock_intent(
        kind="agent",
        tools=["compose_report", "draft_email"],
        reason="compound_goal",
    )
    decision = asyncio.run(
        classify_orb_intent(
            "Research quantum computing, write a report, and email it to john@example.com",
            thread_message_count=0,
        )
    )
    assert decision.kind == "agent"
    assert decision.reason == "compound_goal"


def test_emails_today_in_active_thread_routes_to_gmail(mock_intent):
    mock_intent(kind="direct", tools=["gmail_recent"], reason="inbox_list")
    session = OrbSessionState(
        session_id="s1",
        user_id="u1",
        last_tool="ask_briefly",
        last_transcript="what's in my briefing today",
        route_kind="ask_briefly",
        last_answer="Here are today's headlines...",
    )
    decision = asyncio.run(
        classify_orb_intent(
            "So what are the emails I got today?",
            thread_message_count=4,
            session=session,
            session_has_prior_turn=True,
        )
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "gmail_recent"


def test_email_it_after_report_routes_to_draft_email(mock_intent):
    mock_intent(kind="direct", tools=["draft_email"], reason="email_report")
    session = OrbSessionState(
        session_id="s1",
        user_id="u1",
        last_tool="compose_report",
        route_reason="research_report",
    )
    decision = asyncio.run(
        classify_orb_intent(
            "email it",
            thread_message_count=4,
            session=session,
            session_has_prior_turn=True,
        )
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "draft_email"


def test_write_report_in_active_thread(mock_intent):
    mock_intent(kind="direct", tools=["compose_report"], reason="research_report")
    session = OrbSessionState(session_id="s1", user_id="u1", last_tool="ask_briefly")
    decision = asyncio.run(
        classify_orb_intent(
            "write a report on quantum computing",
            thread_message_count=3,
            session=session,
            session_has_prior_turn=True,
        )
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "compose_report"


def test_compound_goal_starts_session_goal(mock_intent):
    mock_intent(kind="agent", tools=["compose_report", "draft_email"], reason="compound_goal")
    session = OrbSessionState(session_id="s1", user_id="u1")
    asyncio.run(
        classify_orb_intent(
            "Research AI and email me a report",
            thread_message_count=0,
            session=session,
        )
    )
    assert session.active_goal is not None
    assert session.active_goal.get("status") == "active"
