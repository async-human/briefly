"""
Orb intent classification — unified routing with thread memory.

Combines regex fast-path, semantic embedding match, and session context so
follow-up turns still hit the right tool (e.g. calendar after calendar).
"""
from __future__ import annotations

import logging
import re

from briefly_api.services.corpus_queries import is_corpus_library_query
from briefly_api.services.orb_goal import (
    classify_goal_routing,
    is_goal_followup,
    start_goal,
    wants_web_search,
)
from briefly_api.services.orb_router import RouteDecision, regex_matches, route_transcript
from briefly_api.services.orb_session import OrbSessionState
from briefly_api.services.orb_tools import DATA_TOOLS, OrbTool
from briefly_api.services.orb_voice_interaction import is_incomplete_utterance

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


_EXPLICIT_REPORT_RE = re.compile(
    r"\b(create|write|compose|draft|prepare|make|generate)\s+(?:a\s+|my\s+|the\s+)?"
    r"(?:detailed\s+)?(?:report|summary|write-up)\b",
    re.IGNORECASE,
)
_REPORT_EMAIL_RE = re.compile(r"\b(?:send|email|mail)\b", re.IGNORECASE)
_RESEARCH_REPORT_RE = re.compile(
    r"\bresearch\b.{0,120}\b(?:write|create|compose|draft|prepare|make)\b.{0,40}\b(?:report|summary)\b"
    r"|\b(?:write|create|compose|draft|prepare|make)\b.{0,40}\b(?:report|summary)\b.{0,80}\bresearch\b",
    re.IGNORECASE,
)


_NARRATE_REPORT_RE = re.compile(
    r"\b(read|narrate|speak)\s+(?:it|the\s+report|the\s+full\s+report|(?:it\s+)?(?:out\s+)?aloud)\b"
    r"|\bread\s+(?:the\s+)?(?:full\s+)?report\b"
    r"|\btell\s+me\s+(?:the\s+)?(?:full\s+)?report\b"
    r"|\bgo\s+ahead\s+(?:and\s+)?read\b"
    r"|\b(read|narrate)\s+(?:the\s+)?report\s+(?:to\s+me|please)\b",
    re.IGNORECASE,
)
_EMAIL_REPORT_RE = re.compile(
    r"\b(?:email|send|mail)\s+(?:me\s+)?(?:this|the|my)\s+report\b"
    r"|\b(?:email|send|mail)\s+(?:the\s+)?report\b"
    r"|\b(?:email|send|mail)\s+(?:it|this)\b",
    re.IGNORECASE,
)
_DRAFT_EMAIL_RE = re.compile(
    r"\b(draft|write|compose|send|email|mail)\s+(?:an?\s+)?(?:e-?mail|message|note)\b"
    r"|\be-?mail\s+(?:to|him|her|them|my|a|this|the)\b"
    r"|\bsend\s+(?:an?\s+)?(?:e-?mail|message|it)\b",
    re.IGNORECASE,
)
_ACTION_TOOL_NAMES = frozenset(
    {
        "compose_report",
        "narrate_report",
        "draft_email",
        "revise_email",
        "send_email",
        "confirm_send",
        "save_email_to_gmail",
    }
)


def _wants_narrate_report(text: str, session: OrbSessionState | None = None) -> bool:
    if re.search(r"\b(?:email|inbox|gmail)\b", text, re.IGNORECASE):
        return False
    if _NARRATE_REPORT_RE.search(text):
        return True
    if session and session.last_tool in ("compose_report", "narrate_report"):
        if re.search(
            r"^\s*(?:yes|yeah|sure|please|ok|okay)?\s*,?\s*"
            r"(?:read\s+(?:it|the\s+report|it\s+aloud|the\s+full\s+report)|narrate\s+it|go\s+ahead)\s*[.?!]?\s*$",
            text,
            re.IGNORECASE,
        ):
            return True
        if re.search(r"\b(read|narrate)\b.{0,20}\b(?:full\s+)?report\b", text, re.IGNORECASE):
            return True
        if re.search(r"\bfull\s+report\b.{0,12}\baloud\b", text, re.IGNORECASE):
            return True
    return False


def _wants_draft_email(text: str, session: OrbSessionState | None = None) -> bool:
    if (
        (_RESEARCH_REPORT_RE.search(text) or _EXPLICIT_REPORT_RE.search(text))
        and _REPORT_EMAIL_RE.search(text)
        and _has_email_recipient(text)
    ):
        return False
    if _DRAFT_EMAIL_RE.search(text) or _EMAIL_REPORT_RE.search(text):
        return True
    if session and session.last_tool in ("compose_report", "narrate_report"):
        if re.search(r"\b(email|send|mail|draft)\b", text, re.IGNORECASE):
            return True
    if session and session.last_tool in ("draft_email", "revise_email"):
        if re.search(r"\b(send|confirm|email|mail|save)\b", text, re.IGNORECASE):
            return True
    if session and session.route_reason in ("research_report", "email_report"):
        if re.search(r"\b(email|send|mail|draft)\b", text, re.IGNORECASE):
            return True
    return False


def _has_email_recipient(text: str) -> bool:
    return bool(
        re.search(r"\bto\s+[\w.+-]+@[\w.-]+\.\w+\b", text, re.IGNORECASE)
        or re.search(r"\bto\s+[A-Za-z][\w.\- ]{1,40}\b", text, re.IGNORECASE)
    )


def _routes_to_compose_report(text: str) -> bool:
    """Single-shot report goals — compose_report already runs web + corpus research."""
    has_report_intent = (
        bool(_RESEARCH_REPORT_RE.search(text))
        or bool(_EXPLICIT_REPORT_RE.search(text))
        or (
            re.search(r"\breport\b", text, re.IGNORECASE)
            and re.search(r"\bresearch\b", text, re.IGNORECASE)
        )
    )
    if not has_report_intent:
        return False
    # Same utterance with a named recipient needs agent/email tools, not compose alone.
    if _REPORT_EMAIL_RE.search(text) and _has_email_recipient(text):
        return False
    return True


def _pick_direct_tool(
    matched: list[OrbTool],
    text: str,
    session: OrbSessionState | None,
) -> OrbTool | None:
    """Prefer action tools over ask_briefly when utterance matches report/email work."""
    if _wants_narrate_report(text, session):
        tool = _BY_NAME.get("narrate_report")
        if tool is not None:
            return tool
    if _routes_to_compose_report(text):
        tool = _BY_NAME.get("compose_report")
        if tool is not None:
            return tool
    if _wants_draft_email(text, session):
        tool = _BY_NAME.get("draft_email")
        if tool is not None:
            return tool
    if len(matched) == 1:
        return matched[0]
    names = {t.name for t in matched}
    if names & _ACTION_TOOL_NAMES:
        for name in (
            "confirm_send",
            "send_email",
            "draft_email",
            "narrate_report",
            "compose_report",
            "revise_email",
            "save_email_to_gmail",
        ):
            if name in names:
                return _BY_NAME.get(name)
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
    picked = _pick_direct_tool(matched, text, session)
    if picked is not None:
        reason = picked.name
        if picked.name == "compose_report":
            reason = "research_report"
        elif picked.name == "draft_email" and _EMAIL_REPORT_RE.search(text):
            reason = "email_report"
        log.debug("orb intent → %s (picked)", picked.name)
        return RouteDecision(
            kind="direct",
            tools=(picked,),
            confidence=1.0,
            reason=reason,
        )

    if wants_web_search(text):
        web_tool = _BY_NAME.get("web_search")
        if web_tool is not None:
            log.debug("orb intent explicit web → web_search")
            return RouteDecision(
                kind="direct",
                tools=(web_tool,),
                confidence=1.0,
                reason="explicit_web",
            )

    if is_incomplete_utterance(text):
        return RouteDecision(kind="clarify", confidence=1.0, reason="incomplete_utterance")

    goal_decision = classify_goal_routing(text, session, matched_tool_count=len(matched))
    if goal_decision is not None and goal_decision.reason == "compound_goal":
        if _routes_to_compose_report(text):
            report_tool = _BY_NAME.get("compose_report")
            if report_tool is not None:
                log.debug("orb intent compound report → compose_report first")
                return RouteDecision(
                    kind="direct",
                    tools=(report_tool,),
                    confidence=0.98,
                    reason="research_report",
                )
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
        if session and session.active_goal and session.active_goal.get("status") in (
            "active",
            "awaiting_confirm",
        ):
            if is_goal_followup(text) or session.route_kind in ("agent", "clarify"):
                return RouteDecision(kind="agent", confidence=0.95, reason="goal_continue")
        picked = _pick_direct_tool(matched, text, session)
        if picked is not None:
            return RouteDecision(
                kind="direct",
                tools=(picked,),
                confidence=0.98,
                reason=picked.name,
            )
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
