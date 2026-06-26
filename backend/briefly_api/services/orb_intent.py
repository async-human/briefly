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
from briefly_api.services.orb_tools import DATA_TOOLS

log = logging.getLogger(__name__)

_BY_NAME = {t.name: t for t in DATA_TOOLS}
_GMAIL_TOOLS = frozenset({"gmail_search", "gmail_recent"})


def _normalize_decision(
    decision: RouteDecision,
    transcript: str,
    session: OrbSessionState | None,
) -> RouteDecision:
    """Structural fixes so single-step Gmail work never loops through agent/clarify."""
    text = (transcript or "").strip()

    if session and decision.reason in ("goal_resume", "goal_continue"):
        goal = session.active_goal
        if decision.reason == "goal_resume" and (
            not goal or goal.get("status") != "awaiting_confirm"
        ):
            log.debug("orb intent: rejected false goal_resume")
            if goal and goal.get("status") == "active" and not goal.get("pending_tool"):
                clear_goal(session)
            search = _BY_NAME.get("gmail_search")
            if search and _mentions_gmail_search(text):
                return RouteDecision(
                    kind="direct",
                    tools=(search,),
                    confidence=0.9,
                    reason="gmail_search",
                    tool_args=decision.tool_args,
                )

    if decision.kind == "agent" and decision.tools:
        if all(t.name in _GMAIL_TOOLS for t in decision.tools):
            search = next((t for t in decision.tools if t.name == "gmail_search"), None)
            recent = next((t for t in decision.tools if t.name == "gmail_recent"), None)
            tool = search or recent or decision.tools[0]
            log.debug("orb intent: coerced gmail agent → direct %s", tool.name)
            return RouteDecision(
                kind="direct",
                tools=(tool,),
                confidence=decision.confidence,
                reason="gmail_search" if tool.name == "gmail_search" else "gmail_inbox",
                tool_args=decision.tool_args,
            )

    if decision.kind == "ask_briefly" and _mentions_gmail_search(text):
        search = _BY_NAME.get("gmail_search")
        if search is not None:
            log.debug("orb intent: coerced ask_briefly → gmail_search")
            return RouteDecision(
                kind="direct",
                tools=(search,),
                confidence=0.92,
                reason="gmail_search",
                tool_args=decision.tool_args,
            )

    if decision.kind == "clarify" and _mentions_gmail_search(text):
        search = _BY_NAME.get("gmail_search")
        if search is not None:
            log.debug("orb intent: coerced clarify → gmail_search (intent already clear)")
            return RouteDecision(
                kind="direct",
                tools=(search,),
                confidence=0.9,
                reason="gmail_search",
                tool_args=decision.tool_args,
            )

    return decision


def _mentions_gmail_search(text: str) -> bool:
    t = (text or "").lower()
    if not t:
        return False
    if "email" in t or "e-mail" in t or "inbox" in t or "gmail" in t or "mail from" in t:
        if any(w in t for w in (" from ", " about ", " regarding ", " search ", " find ")):
            return True
        if "emails from" in t or "email from" in t or "mail from" in t:
            return True
        if "any emails" in t or "any email" in t:
            return True
    return False


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
    decision = _normalize_decision(decision, text, session)

    if session and decision.reason == "goal_cancelled":
        clear_goal(session)
    if (
        session
        and decision.kind == "agent"
        and decision.reason in ("compound_goal", "multi_step_goal")
    ):
        start_goal(session, text)

    return decision
