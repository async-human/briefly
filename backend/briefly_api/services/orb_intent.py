"""
Orb intent classification — unified routing with thread memory.

Combines regex fast-path, semantic embedding match, and session context so
follow-up turns still hit the right tool (e.g. calendar after calendar).
"""
from __future__ import annotations

import logging
import re

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


def _affinity_tool(session: OrbSessionState | None, transcript: str) -> OrbTool | None:
    if not session or not session.last_tool:
        return None
    patterns = _TOOL_AFFINITY.get(session.last_tool)
    if not patterns:
        return None
    text = (transcript or "").strip()
    if not text:
        return None
    if not (_FOLLOW_UP_RE.search(text) or any(re.search(p, text, re.I) for p in patterns)):
        return None
    return _BY_NAME.get(session.last_tool)


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

    matched = regex_matches(text)
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
        # Semantic tool match allowed in active threads (was ask_briefly-only).
        decision = await route_transcript(
            text,
            thread_message_count=0,
            session_thread_id=None,
            session_has_prior_turn=False,
        )
        if decision.kind in {"direct", "agent"} and decision.tools:
            decision = RouteDecision(
                kind=decision.kind,
                tools=decision.tools,
                confidence=decision.confidence,
                reason=f"semantic_in_thread:{decision.reason}",
            )
            return decision
        return RouteDecision(kind="ask_briefly", confidence=1.0, reason="active_thread_rag")

    return await route_transcript(
        text,
        thread_message_count=thread_message_count,
        session_thread_id=session_thread_id,
        session_has_prior_turn=session_has_prior_turn,
    )
