"""
Human-like voice interaction — acknowledgments, clarifying questions, and step bridges.

Keeps the orb from silently diving into tools. It speaks first, asks when something
is missing, and narrates the first step before long work begins.
"""
import re

from briefly_api.services.corpus_queries import extract_topic_terms, is_corpus_library_query
from briefly_api.services.orb_goal import is_compound_goal, should_resume_goal, step_label
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
_EMAIL_SEND_RE = re.compile(r"\b(?:send|email|mail)\b", re.IGNORECASE)
_EMAIL_HAS_RECIPIENT_RE = re.compile(
    r"\b(?:to|for)\s+[A-Za-z@][\w@.\-+ ]{1,48}\b|\b[\w.+-]+@[\w.-]+\.\w+\b",
    re.IGNORECASE,
)
_BARE_REPORT_RE = re.compile(
    r"^\s*(?:can you|could you|please|would you|help me|i want you to)?\s*"
    r"(?:write|draft|compose|prepare|create)\s+(?:a|an|my|the)?\s*"
    r"(?:report|summary|brief)\s*[.?!]?\s*$",
    re.IGNORECASE,
)
_BARE_RESEARCH_RE = re.compile(
    r"^\s*(?:can you|could you|please|would you|help me|i want you to)?\s*"
    r"(?:research|look up|investigate|find out about)\s*[.?!]?\s*$",
    re.IGNORECASE,
)
_TOPIC_IN_REQUEST_RE = re.compile(
    r"\b(?:about|on|for|regarding|over)\s+[a-z0-9][\w\s\-]{2,}",
    re.IGNORECASE,
)
_SHORT_COMPLETE_WORDS = frozenset(
    {
        "ai", "ml", "ok", "pm", "am", "us", "uk", "eu", "it", "id", "go", "no", "yes",
        "web", "app", "api", "llm", "llms",
    }
)
_COMPLETE_SUFFIXES = ("ing", "tion", "ment", "ness", "ally", "able", "ible", "ists", "ism", "ers", "ary")


def _looks_like_complete_word(word: str) -> bool:
    w = word.lower()
    if w in _SHORT_COMPLETE_WORDS:
        return True
    if len(w) >= 9:
        return True
    return any(w.endswith(s) for s in _COMPLETE_SUFFIXES)

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
    "narrate_report": "Sure — I'll read your report.",
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
    "explicit_web": "Alright — I'll search the web for that.",
    "explicit_report": "Got it — I'll research that and write your report.",
    "research_report": "Got it — I'll research that and write your report.",
    "narrate_report": "Sure — I'll read your report aloud.",
    "email_report": "Okay — I'll draft an email with your report.",
}


def is_incomplete_utterance(text: str) -> bool:
    """True when STT likely cut the user off mid-thought."""
    t = (text or "").strip()
    if not t:
        return True
    if _TRAILING_ELLIPSIS_RE.search(t) or _INCOMPLETE_TRAIL_RE.search(t):
        return True
    return _looks_truncated(t)


def _looks_truncated(text: str) -> bool:
    """Detect STT cut off mid-word (e.g. ending in 'researc' without punctuation)."""
    t = (text or "").strip()
    if not t or t.endswith((".", "!", "?")):
        return False
    words = t.split()
    if not words or len(t) < 20:
        return False
    last = words[-1]
    if not last.isalpha() or last.lower() in _SHORT_COMPLETE_WORDS:
        return False
    if _looks_like_complete_word(last):
        return False
    return len(last) <= 8


def merge_clarification_follow_up(
    transcript: str,
    session: OrbSessionState | None,
) -> str:
    """Merge a short answer after a clarify turn with the original user request."""
    text = (transcript or "").strip()
    if not session or not session.pending_user_goal:
        return text
    if session.route_kind != "clarify":
        return text
    if not text or len(text.split()) > 12:
        return text
    merged = f"{session.pending_user_goal} {text}".strip()
    session.pending_user_goal = None
    return merged


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

    if decision.kind in ("direct", "clarify"):
        return None

    if is_incomplete_utterance(text):
        return (
            "It sounds like you were still talking — could you finish that thought for me?"
        )

    # Compound / agent tasks already encode enough intent — don't second-guess routing.
    if decision.kind == "agent" or is_compound_goal(text):
        return None

    if _VAGUE_TASK_RE.match(text):
        return "Happy to help — what would you like me to do exactly?"

    if (
        _EMAIL_SEND_RE.search(text)
        and not _EMAIL_HAS_RECIPIENT_RE.search(text)
        and not is_compound_goal(text)
    ):
        return "Who should I send that to, and what's it about?"

    if _BARE_REPORT_RE.match(text):
        return "What topic should the report cover?"

    if _BARE_RESEARCH_RE.match(text):
        return "What would you like me to research?"

    if is_corpus_library_query(text):
        terms = extract_topic_terms(text)
        if not terms and re.search(r"\b(?:articles?|content|reads?|library)\s*$", text, re.I):
            return "Which topic or subject should I look for in your library?"

    if _TOPIC_IN_REQUEST_RE.search(text):
        return None

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
    return f"{label}."


def _clean_planner_thought(thought: str) -> str:
    text = (thought or "").strip()
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text)
    if text.lower().startswith("i will"):
        text = text[0].upper() + text[1:]
    if text and text[-1] not in ".!?":
        text += "."
    return text


def spoken_agent_narration(
    tool_name: str | None,
    thought: str,
    *,
    seen_tools: set[str],
) -> str | None:
    """Human-like step narration — prefer planner reasoning, never repeat the same tool."""
    cleaned = _clean_planner_thought(thought)
    if cleaned and len(cleaned.split()) >= 4:
        return cleaned
    tool = (tool_name or "").strip()
    if not tool or tool in seen_tools:
        return None
    seen_tools.add(tool)
    variants: dict[str, tuple[str, ...]] = {
        "web_search": (
            "Let me search the web for the latest on this.",
            "I'll check what's out there online first.",
        ),
        "compose_report": (
            "Now I'll pull your sources together and write the report.",
            "Give me a moment — I'm putting your report together.",
        ),
        "ask_briefly": (
            "Let me look through your saved articles on this.",
            "I'll check your library for relevant material.",
        ),
    }
    options = variants.get(tool)
    if options:
        idx = len(seen_tools) % len(options)
        return options[idx]
    label = step_label(tool)
    return f"{label}." if label != "Thinking" else None
