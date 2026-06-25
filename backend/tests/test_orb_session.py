"""Orb session state persistence and field roundtrip."""
from __future__ import annotations

import asyncio

from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_session import OrbSessionState, update_session_after_turn


def test_session_route_reason_roundtrip():
    state = OrbSessionState(session_id="s1", user_id="u1")
    asyncio.run(
        update_session_after_turn(
            state,
            transcript="research quantum computing",
            last_tool="compose_report",
            route_kind="direct",
            route_reason="research_report",
            last_answer="Report ready.",
        )
    )
    restored = OrbSessionState.from_dict(state.to_dict())
    assert restored.route_reason == "research_report"
    assert restored.last_tool == "compose_report"
    assert restored.route_kind == "direct"


def test_session_from_dict_without_route_reason(mock_intent):
    """Older Redis payloads omit route_reason — must not crash on load."""
    mock_intent(kind="direct", tools=["draft_email"], reason="email_report")
    data = {
        "session_id": "s1",
        "user_id": "u1",
        "last_tool": "compose_report",
        "route_kind": "direct",
    }
    session = OrbSessionState.from_dict(data)
    assert session.route_reason is None
    decision = asyncio.run(
        classify_orb_intent(
            "email it",
            thread_message_count=2,
            session=session,
            session_has_prior_turn=True,
        )
    )
    assert decision.tools[0].name == "draft_email"
