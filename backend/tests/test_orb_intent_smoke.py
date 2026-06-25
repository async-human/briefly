"""Smoke tests: classify_orb_intent must not crash for any session field combo."""
from __future__ import annotations

import asyncio
import inspect

from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_session import OrbSessionState


def _session_field_names() -> set[str]:
    return {f.name for f in OrbSessionState.__dataclass_fields__.values()}


def test_orb_session_fields_match_intent_usage():
    """Every session.* access in orb_intent must exist on OrbSessionState."""
    import briefly_api.services.orb_intent as mod

    source = inspect.getsource(mod)
    # crude but catches missing dataclass fields like route_reason
    for name in (
        "last_tool",
        "last_transcript",
        "last_answer",
        "route_kind",
        "route_reason",
        "active_goal",
    ):
        assert f"session.{name}" in source or f"getattr(session, \"{name}\"" in source
        assert name in _session_field_names()


_TRANSCRIPTS = (
    "what's on my calendar tomorrow",
    "research AI agents and write a report",
    "email it to me",
    "read the report aloud",
    "what's the weather in Pune",
    "more details",
    "search my inbox for invoices",
    "draft an email to john@example.com",
)


def test_classify_orb_intent_smoke_with_full_session():
    session = OrbSessionState(
        session_id="s1",
        user_id="u1",
        last_tool="compose_report",
        route_reason="research_report",
        last_transcript="research quantum computing",
        last_answer="Report is ready.",
        route_kind="direct",
    )
    for text in _TRANSCRIPTS:
        decision = asyncio.run(
            classify_orb_intent(
                text,
                thread_message_count=4,
                session=session,
                session_has_prior_turn=True,
            )
        )
        assert decision.kind in ("direct", "agent", "ask_briefly", "clarify")
