"""Shared test fixtures for orb intent (LLM router)."""
from __future__ import annotations

import pytest

from briefly_api.services.orb_router import RouteDecision
from briefly_api.services.orb_tools import DATA_TOOLS

_BY_NAME = {t.name: t for t in DATA_TOOLS}


@pytest.fixture
def mock_intent(monkeypatch):
    """Patch LLM intent router with a configurable RouteDecision."""

    async def _fake_classify_intent_with_llm(transcript, **kwargs):
        return _fake_classify_intent_with_llm._decision

    _fake_classify_intent_with_llm._decision = RouteDecision(
        kind="ask_briefly", reason="test_default"
    )

    def set_decision(
        *,
        kind: str = "ask_briefly",
        tools: list[str] | None = None,
        reason: str = "test",
        clarifying_question: str | None = None,
    ) -> None:
        tool_objs = [_BY_NAME[n] for n in (tools or []) if n in _BY_NAME]
        if kind == "direct" and tool_objs:
            _fake_classify_intent_with_llm._decision = RouteDecision(
                kind="direct",
                tools=(tool_objs[0],),
                confidence=0.95,
                reason=reason,
                clarifying_question=clarifying_question,
            )
        elif kind == "agent" and tool_objs:
            _fake_classify_intent_with_llm._decision = RouteDecision(
                kind="agent",
                tools=tuple(tool_objs[:3]),
                confidence=0.95,
                reason=reason,
                clarifying_question=clarifying_question,
            )
        elif kind == "clarify":
            _fake_classify_intent_with_llm._decision = RouteDecision(
                kind="clarify",
                confidence=0.95,
                reason=reason,
                clarifying_question=clarifying_question,
            )
        else:
            _fake_classify_intent_with_llm._decision = RouteDecision(
                kind="ask_briefly",
                confidence=0.95,
                reason=reason,
                clarifying_question=clarifying_question,
            )

    monkeypatch.setattr(
        "briefly_api.services.orb_intent.classify_intent_with_llm",
        _fake_classify_intent_with_llm,
    )
    return set_decision
