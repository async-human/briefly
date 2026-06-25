"""Tests for report extraction and web search answer formatting."""
from __future__ import annotations

import asyncio

from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_reports import (
    build_report_ready_answer,
    extract_report_goal,
    narrate_cached_report,
)
from briefly_api.services.orb_report_cache import store_report
from briefly_api.services.orb_session import OrbSessionState


def test_extract_report_goal_create_report_on_topic():
    goal = extract_report_goal("create a report on quantum computing", None)
    assert "quantum" in goal.lower()


def test_extract_report_goal_write_report():
    goal = extract_report_goal("write a report about AI safety", None)
    assert "ai safety" in goal.lower()


def test_report_ready_offers_choice_not_full_body():
    body = "Paragraph one about quantum. Paragraph two with more detail. Paragraph three."
    answer = build_report_ready_answer("quantum computing", body)
    assert "Would you like" in answer
    assert "read the full report" in answer.lower()
    assert body not in answer


def test_narrate_cached_report():
    store_report("u1", "quantum computing", "Full report body here.")
    out = narrate_cached_report("u1")
    assert out.get("narrate_mode") is True
    assert "Full report body here." in out.get("answer", "")


def test_read_it_after_report_routes_to_narrate(mock_intent):
    mock_intent(kind="direct", tools=["narrate_report"], reason="narrate_report")
    session = OrbSessionState(
        session_id="s1",
        user_id="u1",
        last_tool="compose_report",
    )
    decision = asyncio.run(
        classify_orb_intent("read it aloud", thread_message_count=2, session=session)
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "narrate_report"
