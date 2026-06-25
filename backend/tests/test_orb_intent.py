"""Tests for orb intent thread affinity and report routing."""
from __future__ import annotations

import asyncio

from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_session import OrbSessionState


def test_thread_affinity_calendar_follow_up():
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
    assert decision.reason == "thread_affinity"


def test_research_and_report_routes_to_compose_report_not_agent():
    decision = asyncio.run(
        classify_orb_intent(
            "Can you do some research on quantum computing and write me a report?",
            thread_message_count=0,
        )
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "compose_report"
    assert decision.reason == "research_report"


def test_research_report_with_email_stays_agent():
    decision = asyncio.run(
        classify_orb_intent(
            "Research quantum computing, write a report, and email it to me",
            thread_message_count=0,
        )
    )
    assert decision.kind == "agent"
    assert decision.reason == "compound_goal"
