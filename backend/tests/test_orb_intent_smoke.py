"""Smoke tests: classify_orb_intent with mocked LLM."""
from __future__ import annotations

import asyncio
import inspect

from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_session import OrbSessionState


def _session_field_names() -> set[str]:
    return {f.name for f in OrbSessionState.__dataclass_fields__.values()}


def test_orb_session_fields_used_in_llm_context():
    import briefly_api.services.orb_intent_llm as mod

    source = inspect.getsource(mod._session_block)
    for name in (
        "last_tool",
        "last_transcript",
        "last_answer",
        "route_kind",
        "route_reason",
        "active_goal",
    ):
        assert name in source
        assert name in _session_field_names()


def test_classify_orb_intent_smoke_with_full_session(mock_intent):
    mock_intent(kind="direct", tools=["gmail_recent"], reason="inbox_list")
    session = OrbSessionState(
        session_id="s1",
        user_id="u1",
        last_tool="compose_report",
        route_reason="research_report",
        last_transcript="research quantum computing",
        last_answer="Report is ready.",
        route_kind="direct",
    )
    for text in (
        "what's on my calendar tomorrow",
        "So what are the emails I got today?",
        "more details",
    ):
        decision = asyncio.run(
            classify_orb_intent(
                text,
                thread_message_count=4,
                session=session,
                session_has_prior_turn=True,
            )
        )
        assert decision.kind in ("direct", "agent", "ask_briefly", "clarify")
