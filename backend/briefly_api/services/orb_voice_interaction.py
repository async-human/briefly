"""
Human-like voice interaction — acknowledgments, clarifying questions, and step bridges.

Keeps the orb from silently diving into tools. It speaks first, asks when something
is missing, and narrates the first step before long work begins.
"""
from __future__ import annotations

import re

from briefly_api.services.corpus_queries import extract_topic_terms, is_corpus_library_query
from briefly_api.services.orb_goal import should_resume_goal, step_label
from briefly_api.services.orb_router import RouteDecision
from briefly_api.services.orb_session import OrbSessionState

_INCOMPLETE_TRAIL_RE = re.compile(
    r"\b(and|or|also|plus|about|for|on|the|a|an|to|with|in|of|that|which|what|where|"
    r"when|who|how|like|as|from|into|by|at|but|so|if|because|while|than|then)\s*$",
    re.IGNORECASE,
)
_TRAILING_ELLIPSIS_RE = re.compile(r"\.{2,}\s*$|\s…\s*$")
_VAGUE_TASK_RE = re.compile(
    r"^\s*(?:can you|could you|please|i want you to|i need you to|help me)\s*"
    r"(?:do|run|execute|start|go)\s*(?:it|this|that|something)?\s*[.?!]?\s*$",
    re.IGNORECASE,
)
_EMAIL_NO_RECIPIENT_RE = re.compile(
    r"\b(?:send|email|mail|draft)\b",
    re.IGNORECASE,
)
_EMAIL_HAS_RECIPIENT_RE = re.compile(
    r"\b(?:to|for)\s+[A-Za-z@][\w@.\-+ ]{1,48}\b|\b[\w.+-]+@[\w.-]+\.\w+\b",
    re.IGNORECASE,
)
_REPORT_NO_TOPIC_RE = re.compile(
    r"\b(?:write|draft|compose|prepare|create)\s+(?:a|an|my|the)?\s*"
    r"(?:report|summary|email|brief)\s*[.?!]?\s*$",
    re.IGNORECASE,
)
_RESEARCH_NO_TOPIC_RE = re.compile(
    r"\b(?:research|look up|investigate|find out about)\s*[.?!]?\s*$",
    re.IGNORECASE,
)

_ACK_BY_TOOL: dict[str, str] = {
    "ask_briefly": "Good question — let me look through your library.",
    "calendar_upcoming": "Sure — I'll check your calendar.",
    "meeting_prep": "Okay — I'll pull together meeting context.",
    "gmail_recent": "One moment — I'll check your inbox.",
    "gmail_search": "Got it — I'll search your email.",
    "today_brief": "Let me read through your briefing.",
    "saved_queue": "I'll check what's in your saved queue.",
    "weather": "One sec — I'll look up the weather.",
    "current_datetime": "Sure.",
    "draft_email": "Okay — I'll draft that email.",
    "compose_report": "Got it — I'll work on that report.",
    "web_search": "Alright — I'll search for that.",
    "user_preferences": "Let me check your profile.",
    "start_research": "Sure — I'll start researching that.",
    "capture_thought": "Got it — I'll save that note.",
}

_ACK_BY_REASON: dict[str, str] = {
    "corpus_library": "Sure — let me look through your articles for that.",
    "compound_goal": "Got it. I'll work through that step by step.",
    "goal_resume_confirm": "Perfect — I'll continue where we left off.",
    "goal_continue": "Okay — picking up from before.",
    "multi_tool": "Alright — I'll handle that in a few steps.",
    "semantic_multi": "Got it — I'll work through that.",
    "agent": "Understood. Let me figure out the best way to help.",
}


def detect_clarification(
    transcript: str,
    decision: RouteDecision,
    *,
    session: OrbSessionState | None = None,
) -> str | None:
    """Return a spoken clarifying question, or None if we can proceed."""
    text = (transcript or "").strip()
    if not text:
        return "I didn't catch that — what would you like to know?"

    if session and should_resume_goal(session, text):
        return None

    if _TRAILING_ELLIPSIS_RE.search(text) or _INCOMPLETE_TRAIL_RE.search(text):
        return (
            "It sounds like you were still talking — could you finish that thought for me?"
        )

    if _VAGUE_TASK_RE.match(text):
        return "Happy to help — what would you like me to do exactly?"

    lower = text.lower()
    if _EMAIL_NO_RECIPIENT_RE.search(text) and not _EMAIL_HAS_RECIPIENT_RE.search(text):
        if any(w in lower for w in ("send", "email", "mail", "draft")):
            return "Who should I send that to, and what's it about?"

    if _REPORT_NO_TOPIC_RE.search(text):
        return "What topic should the report cover?"

    if _RESEARCH_NO_TOPIC_RE.search(text):
        return "What would you like me to research?"

    if is_corpus_library_query(text):
        terms = extract_topic_terms(text)
        if not terms and re.search(r"\b(?:articles?|content|reads?|library)\s*$", text, re.I):
            return "Which topic or subject should I look for in your library?"

    if decision.kind == "agent" and decision.reason == "compound_goal":
        if not re.search(r"\b(?:about|on|for|regarding|to)\s+\w{2,}", text, re.I):
            return "Can you tell me a bit more about what you'd like me to focus on?"

    return None


def spoken_acknowledgment(
    transcript: str,
    decision: RouteDecision,
) -> str | None:
    """Short spoken filler before work begins — keeps the orb from going silent."""
    reason = decision.reason or ""
    if reason in _ACK_BY_REASON:
        return _ACK_BY_REASON[reason]

    if decision.tools:
        tool = decision.tools[0].name
        if tool in _ACK_BY_TOOL:
            return _ACK_BY_TOOL[tool]

    if decision.kind == "agent":
        return _ACK_BY_REASON["agent"]

    if decision.kind == "ask_briefly":
        text = (transcript or "").strip()
        if is_corpus_library_query(text):
            terms = extract_topic_terms(text)
            if terms:
                topic = " ".join(terms[:3])
                return f"Sure — I'll look through your library for {topic}."
            return _ACK_BY_REASON["corpus_library"]
        return "Good question — let me think about that."

    if decision.kind == "direct" and decision.tools:
        return _ACK_BY_TOOL.get(decision.tools[0].name, "One moment.")

    return "One moment."


def spoken_step_bridge(tool_name: str | None, *, first: bool = False) -> str | None:
    """Brief spoken bridge when the first agent tool starts."""
    if not first or not tool_name:
        return None
    label = step_label(tool_name)
    if label == "Thinking":
        return None
    return f"{label}…"
