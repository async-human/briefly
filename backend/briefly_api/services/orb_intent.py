"""
Orb intent classification — LLM router with session-aware context.

Routing is performed by `classify_intent_with_llm` (see orb_intent_llm.py).
Tool names and descriptions come from the live DATA_TOOLS registry.
"""
from __future__ import annotations

import logging

from briefly_api.services.orb_goal import clear_goal, start_goal
from briefly_api.services.orb_intent_llm import classify_intent_with_llm
from briefly_api.services.orb_router import RouteDecision
from briefly_api.services.orb_session import OrbSessionState

log = logging.getLogger(__name__)


async def classify_orb_intent(
    transcript: str,
    *,
    thread_message_count: int = 0,
    session: OrbSessionState | None = None,
    session_thread_id: str | None = None,
    session_has_prior_turn: bool = False,
    user_id: str | None = None,
) -> RouteDecision:
    """Route a transcript via LLM intent classification."""
    _ = session_thread_id  # reserved for thread-aware extensions
    text = (transcript or "").strip()
    if not text:
        return RouteDecision(kind="ask_briefly", reason="empty")

    active_thread = thread_message_count > 0 or (
        bool(session and session.last_transcript) or session_has_prior_turn
    )
    decision = await classify_intent_with_llm(
        text,
        thread_message_count=thread_message_count,
        session=session,
        session_has_prior_turn=active_thread,
        user_id=user_id or (session.user_id if session else None),
    )

    if session and decision.reason == "goal_cancelled":
        clear_goal(session)
    if (
        session
        and decision.kind == "agent"
        and decision.reason in ("compound_goal", "multi_step_goal")
    ):
        start_goal(session, text)

    return decision
