"""
briefly_api/services/orb_router.py

RouteDecision type and legacy helpers. Primary routing is LLM-based via
`classify_orb_intent` → `classify_intent_with_llm`.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from briefly_api.services.orb_tools import DATA_TOOLS, OrbTool

log = logging.getLogger(__name__)

RouteKind = Literal["direct", "agent", "ask_briefly", "clarify"]


@dataclass(frozen=True)
class RouteDecision:
    kind: RouteKind
    tools: tuple[OrbTool, ...] = ()
    confidence: float = 0.0
    reason: str = ""
    clarifying_question: str | None = None


def regex_matches(transcript: str) -> list[OrbTool]:
    """Legacy helper — fast_patterns are not used for routing anymore."""
    return [t for t in DATA_TOOLS if t.matches(transcript)]


async def route_transcript(
    transcript: str,
    *,
    thread_message_count: int = 0,
    session_thread_id: str | None = None,
    session_has_prior_turn: bool = False,
) -> RouteDecision:
    from briefly_api.services.orb_intent import classify_orb_intent

    return await classify_orb_intent(
        transcript,
        thread_message_count=thread_message_count,
        session_thread_id=session_thread_id,
        session_has_prior_turn=session_has_prior_turn,
    )
