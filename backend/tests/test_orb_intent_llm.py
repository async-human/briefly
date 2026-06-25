"""Unit tests for LLM route response parsing (no API calls)."""
from __future__ import annotations

from briefly_api.services.orb_intent_llm import parse_route_response


def test_parse_direct_single_tool():
    decision = parse_route_response(
        {
            "kind": "direct",
            "tools": ["gmail_recent"],
            "reason": "inbox_list",
            "confidence": 0.92,
        }
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "gmail_recent"
    assert decision.reason == "inbox_list"


def test_parse_direct_unknown_tool_falls_back_to_ask_briefly():
    decision = parse_route_response(
        {"kind": "direct", "tools": ["not_a_real_tool"], "reason": "bad_tool"}
    )
    assert decision.kind == "ask_briefly"
    assert decision.reason == "llm_direct_no_tool"


def test_parse_clarify_includes_question():
    decision = parse_route_response(
        {
            "kind": "clarify",
            "tools": [],
            "reason": "missing_topic",
            "clarifying_question": "What topic should the report cover?",
        }
    )
    assert decision.kind == "clarify"
    assert decision.clarifying_question == "What topic should the report cover?"


def test_parse_agent_multi_tool():
    decision = parse_route_response(
        {
            "kind": "agent",
            "tools": ["web_search", "compose_report", "draft_email"],
            "reason": "compound_goal",
            "confidence": 0.88,
        }
    )
    assert decision.kind == "agent"
    assert [t.name for t in decision.tools] == [
        "web_search",
        "compose_report",
        "draft_email",
    ]
