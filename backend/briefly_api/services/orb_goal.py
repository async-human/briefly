"""
Orb goal state — persistent multi-step objectives across voice turns.

Tracks compound tasks (research → report → email) until complete or the user
confirms a gated write step.
"""
from __future__ import annotations

import re
import uuid
from typing import Any

from briefly_api.services.orb_router import RouteDecision
from briefly_api.services.orb_session import OrbSessionState

_COMPOUND_CONNECTOR = re.compile(
    r"\b(and then|then|after that|afterwards|also|plus|as well as|followed by)\b",
    re.IGNORECASE,
)
_MULTI_ACTION = re.compile(
    r"\b("
    r"research|write|draft|compose|summarize|summary|email|send|report|"
    r"schedule|find|look up|prepare|create"
    r")\b.{0,48}\b(and|then|also)\b",
    re.IGNORECASE,
)
_COMPOUND_GOAL = re.compile(
    r"\b("
    r"research .{0,40} (report|email|summary)|"
    r"write .{0,30} (report|email|summary)|"
    r"draft .{0,30} email|"
    r"email (me|him|her|them|it)|"
    r"send (me|him|her|them|it|an? email)"
    r")\b",
    re.IGNORECASE,
)

_CONFIRM_RE = re.compile(
    r"^\s*(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|send it|confirm|"
    r"approved|proceed|please do|that's fine|sounds good)\b",
    re.IGNORECASE,
)

_DENY_RE = re.compile(
    r"^\s*(no|nope|cancel|stop|don't|do not|never mind|nevermind|wait)\b",
    re.IGNORECASE,
)

STEP_LABELS: dict[str, str] = {
    "ask_briefly": "Searching your library",
    "web_search": "Searching the web",
    "compose_report": "Writing your report",
    "draft_email": "Drafting your email",
    "send_email": "Sending your email",
    "confirm_send": "Confirming send",
    "revise_email": "Updating your draft",
    "today_brief": "Reading your briefing",
    "saved_queue": "Checking saved items",
    "gmail_recent": "Checking your inbox",
    "gmail_search": "Searching your email",
    "calendar_upcoming": "Checking your calendar",
    "meeting_prep": "Preparing meeting context",
    "weather": "Checking the weather",
    "user_preferences": "Reading your profile",
    "start_research": "Starting research",
    "capture_thought": "Saving your note",
}


def step_label(tool_name: str | None) -> str:
    if not tool_name:
        return "Thinking"
    return STEP_LABELS.get(tool_name, tool_name.replace("_", " "))


def is_compound_goal(transcript: str) -> bool:
    text = (transcript or "").strip()
    if not text:
        return False
    if _COMPOUND_CONNECTOR.search(text):
        return True
    if _MULTI_ACTION.search(text):
        return True
    if _COMPOUND_GOAL.search(text):
        return True
    return False


def should_resume_goal(session: OrbSessionState | None, transcript: str) -> bool:
    if not session or not session.active_goal:
        return False
    goal = session.active_goal
    if goal.get("status") != "awaiting_confirm":
        return False
    text = (transcript or "").strip()
    return bool(_CONFIRM_RE.search(text))


def should_cancel_goal(session: OrbSessionState | None, transcript: str) -> bool:
    if not session or not session.active_goal:
        return False
    return bool(_DENY_RE.search((transcript or "").strip()))


def clear_goal(session: OrbSessionState) -> None:
    session.active_goal = None


def start_goal(session: OrbSessionState, objective: str) -> dict[str, Any]:
    goal = {
        "goal_id": str(uuid.uuid4()),
        "objective": objective.strip()[:2000],
        "status": "active",
        "history": [],
        "pending_tool": None,
        "pending_args": None,
        "steps_done": 0,
    }
    session.active_goal = goal
    return goal


def agent_goal_text(session: OrbSessionState | None, transcript: str) -> str:
    """Build the goal string passed to the agent planner."""
    text = (transcript or "").strip()
    if not session or not session.active_goal:
        return text
    goal = session.active_goal
    objective = str(goal.get("objective") or text)
    if goal.get("status") == "awaiting_confirm" and should_resume_goal(session, text):
        pending_tool = goal.get("pending_tool") or "the pending action"
        return (
            f"Original goal: {objective}\n"
            f"USER CONFIRMED the next step. Proceed with '{pending_tool}' and finish the goal."
        )
    if goal.get("status") == "active" and goal.get("history"):
        return (
            f"Continuing goal: {objective}\n"
            f"Latest user message: {text}"
        )
    return objective or text


def agent_history_from_goal(session: OrbSessionState | None) -> list[str]:
    if not session or not session.active_goal:
        return []
    hist = session.active_goal.get("history")
    return list(hist) if isinstance(hist, list) else []


def sync_goal_from_result(
    session: OrbSessionState,
    objective: str,
    *,
    steps: list[Any],
    stopped_reason: str,
) -> None:
    goal = session.active_goal or start_goal(session, objective)
    goal["objective"] = objective[:2000]
    goal["history"] = [
        f"step{s.n}: {s.tool}({s.args}) -> {(s.observation or '')[:220]}"
        for s in steps
        if getattr(s, "tool", None)
    ]
    goal["steps_done"] = len(goal["history"])

    if stopped_reason == "needs_confirmation":
        goal["status"] = "awaiting_confirm"
        pending = steps[-1] if steps else None
        if pending:
            goal["pending_tool"] = getattr(pending, "tool", None)
            goal["pending_args"] = getattr(pending, "args", None) or {}
    elif stopped_reason == "final":
        goal["status"] = "completed"
        goal["pending_tool"] = None
        goal["pending_args"] = None
    elif stopped_reason == "max_steps":
        goal["status"] = "active"
    else:
        goal["status"] = "active"
    session.active_goal = goal


def classify_goal_routing(
    transcript: str,
    session: OrbSessionState | None,
    *,
    matched_tool_count: int,
) -> RouteDecision | None:
    """Return an agent route decision when goal semantics apply."""
    text = (transcript or "").strip()
    if should_cancel_goal(session, text):
        if session:
            clear_goal(session)
        return None
    if should_resume_goal(session, text):
        return RouteDecision(kind="agent", confidence=1.0, reason="goal_resume_confirm")
    if session and session.active_goal and session.active_goal.get("status") == "active":
        if len(text.split()) <= 16 and session.active_goal.get("history"):
            return RouteDecision(kind="agent", confidence=0.9, reason="goal_continue")
    if is_compound_goal(text):
        return RouteDecision(kind="agent", confidence=0.95, reason="compound_goal")
    if matched_tool_count >= 2:
        return RouteDecision(kind="agent", confidence=1.0, reason="multi_tool")
    return None
