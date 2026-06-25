"""
Orb intent classification — unified routing with thread memory.

Combines regex fast-path, semantic embedding match, and session context so
follow-up turns still hit the right tool (e.g. calendar after calendar).
"""
from __future__ import annotations

import logging
import re

from briefly_api.services.corpus_queries import is_corpus_library_query
from briefly_api.services.orb_goal import classify_goal_routing, start_goal
from briefly_api.services.orb_router import RouteDecision, regex_matches, route_transcript
from briefly_api.services.orb_session import OrbSessionState
from briefly_api.services.orb_tools import DATA_TOOLS, OrbTool

log = logging.getLogger(__name__)

_BY_NAME = {t.name: t for t in DATA_TOOLS}

# Follow-up phrases that should stay on the same tool family.
_TOOL_AFFINITY: dict[str, tuple[str, ...]] = {
    "calendar_upcoming": (
        r"\b(calendar|schedule|meeting|tomorrow|today|next week|appointment)\b",
        r"\bwhat about\b",
        r"\band (the )?(rest of|afternoon|evening)\b",
    ),
    "meeting_prep": (r"\bprep\b", r"\bmeeting\b", r"\bbefore the call\b"),
    "gmail_recent": (r"\b(email|inbox|mail|message)\b",),
    "gmail_search": (r"\b(search|find|from|about)\b", r"\bemail\b"),
    "today_brief": (r"\bbrief(ing)?\b", r"\bheadlines\b", r"\bwhat('s| is) new\b"),
    "weather": (r"\bweather\b", r"\btemperature\b", r"\bforecast\b", r"\brain\b"),
    "current_datetime": (r"\b(time|date|day|today)\b",),
    "draft_email": (r"\b(email|draft|send|report)\b",),
    "revise_email": (r"\b(change|edit|shorter|longer|revise)\b",),
    "compose_report": (r"\breport\b", r"\bresearch\b", r"\bsummarize\b"),
    "web_search": (r"\b(search|web|google|look up|internet)\b",),
    "user_preferences": (r"\b(interests|preferences|about me)\b",),
}

_FOLLOW_UP_RE = re.compile(
    r"\b(what about|how about|and tomorrow|and today|anything else|tell me more|"
    r"what else|go on|continue|more on that)\b",
    re.IGNORECASE,
)

_ELLIPSIS_FOLLOWUP_RE = re.compile(
    r"\b(any chance|will it|is there a chance|could it|might it)\b",
    re.IGNORECASE,
)

# Tools that accept short elliptical follow-ups without repeating entities.
_ELLIPSIS_TOOLS = frozenset(
    {"weather", "calendar_upcoming", "gmail_search", "gmail_recent", "meeting_prep"}
)


def _affinity_tool(session: OrbSessionState | None, transcript: str) -> OrbTool | None:
    if not session or not session.last_tool:
        return None
    text = (transcript or "").strip()
    if not text:
        return None

    patterns = _TOOL_AFFINITY.get(session.last_tool)
    if patterns and (
        _FOLLOW_UP_RE.search(text) or any(re.search(p, text, re.I) for p in patterns)
    ):
        return _BY_NAME.get(session.last_tool)

    # Elliptical follow-up: "any chance of rain?" after a weather turn in Pune.
    if session.last_tool in _ELLIPSIS_TOOLS:
        words = text.split()
        if len(words) <= 12 and (
            _ELLIPSIS_FOLLOWUP_RE.search(text)
            or (_FOLLOW_UP_RE.search(text) and len(words) <= 8)
            or (text.endswith("?") and len(words) <= 10)
        ):
            return _BY_NAME.get(session.last_tool)

    return None


async def classify_orb_intent(
    transcript: str,
    *,
    thread_message_count: int = 0,
    session: OrbSessionState | None = None,
    session_thread_id: str | None = None,
    session_has_prior_turn: bool = False,
) -> RouteDecision:
    """Route a transcript to direct tool, agent, or ask_briefly."""
    text = (transcript or "").strip()
    if not text:
        return RouteDecision(kind="ask_briefly", reason="empty")

    # Library / article questions always go to RAG over the full corpus.
    if is_corpus_library_query(text):
        return RouteDecision(kind="ask_briefly", confidence=1.0, reason="corpus_library")

    matched = regex_matches(text)
    goal_decision = classify_goal_routing(text, session, matched_tool_count=len(matched))
    if goal_decision is not None:
        if goal_decision.reason == "compound_goal" and session:
            start_goal(session, text)
        log.debug("orb intent goal → %s", goal_decision.reason)
        return goal_decision

    active_thread = thread_message_count > 0 or (
        bool(session_thread_id) and session_has_prior_turn
    )

    # Thread memory: follow-ups stay on last tool when phrasing suggests continuation.
    affinity = _affinity_tool(session, text)
    if affinity is not None:
        log.debug("orb intent affinity → %s (last_tool=%s)", affinity.name, session.last_tool)
        return RouteDecision(
            kind="direct",
            tools=(affinity,),
            confidence=0.95,
            reason="thread_affinity",
        )

    if active_thread:
        if len(matched) == 1:
            return RouteDecision(
                kind="direct",
                tools=(matched[0],),
                confidence=1.0,
                reason="regex_single_in_thread",
            )
        if len(matched) >= 2:
            return RouteDecision(
                kind="agent",
                tools=tuple(matched[:3]),
                confidence=1.0,
                reason="regex_multi_in_thread",
            )
        return RouteDecision(kind="ask_briefly", confidence=1.0, reason="active_thread_rag")

    return await route_transcript(
        text,
        thread_message_count=thread_message_count,
        session_thread_id=session_thread_id,
        session_has_prior_turn=session_has_prior_turn,
    )
