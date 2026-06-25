"""
LLM intent router for the voice orb.

All routing decisions flow through a single structured LLM call. Tool names and
descriptions come from the live DATA_TOOLS registry — no regex fast-paths.
"""
from __future__ import annotations

import logging
from typing import Any

from briefly_api.config import get_settings
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.orb_router import RouteDecision
from briefly_api.services.orb_session import OrbSessionState
from briefly_api.services.orb_tools import DATA_TOOLS, OrbTool

log = logging.getLogger(__name__)

_BY_NAME: dict[str, OrbTool] = {t.name: t for t in DATA_TOOLS}

_ROUTE_KINDS = frozenset({"direct", "agent", "ask_briefly", "clarify"})

_SYSTEM = (
    "You are Briefly's intent router for a voice assistant. "
    "Given the user's utterance and session context, choose exactly one route.\n\n"
    "ROUTES:\n"
    "- direct: run ONE tool from the catalog (live data or a single action)\n"
    "- agent: multi-step work needing several tools in sequence "
    "(e.g. research + report + email to a named recipient)\n"
    "- ask_briefly: answer from the user's saved articles/library via RAG "
    "(topic questions, 'what have I been reading about X', library/corpus questions, "
    "follow-ups like 'tell me more' on a prior library answer)\n"
    "- clarify: utterance is incomplete or missing critical info — no tool yet\n\n"
    "ROUTING RULES:\n"
    "- Gmail inbox / messages the user received → gmail_recent (NOT today_brief, NOT ask_briefly)\n"
    "- Briefing / digest / headlines for today → today_brief\n"
    "- Calendar / schedule / meetings → calendar_upcoming\n"
    "- Weather / forecast → weather\n"
    "- Honor topic switches mid-conversation (new live-data request beats prior thread topic)\n"
    "- Short follow-ups ('tell me more', 'more details', 'what about tomorrow') continue the "
    "prior tool or ask_briefly based on last_tool and last_answer\n"
    "- After compose_report: 'email it' → draft_email; 'read it aloud' → narrate_report\n"
    "- Single research+report without sending to someone → direct compose_report (NOT agent)\n"
    "- research + report + email to a named recipient in one request → agent\n"
    "- Questions about articles in their library → ask_briefly\n"
    "- If active_goal status is awaiting_confirm and user confirms → agent (reason goal_resume)\n"
    "- If user cancels an in-flight goal → ask_briefly (reason goal_cancelled)\n\n"
    "Respond in STRICT JSON only."
)

_INSTRUCTIONS = (
    'Return JSON: {"kind":"direct|agent|ask_briefly|clarify","tools":["tool_name",...],'
    '"reason":"short_snake_case","confidence":0.0-1.0,"clarifying_question":""}\n'
    "- direct: exactly one tool name in tools\n"
    "- agent: one to three tool names in planned order\n"
    "- ask_briefly / clarify: tools must be []\n"
    "- clarifying_question: one short spoken question when kind=clarify, else empty string"
)


def render_tool_catalog() -> str:
    lines: list[str] = []
    for tool in DATA_TOOLS:
        args = ", ".join(f"{k}: {v}" for k, v in (tool.args_schema or {}).items()) or "none"
        lines.append(f"- {tool.name} [{tool.side_effect}]: {tool.description} (args: {args})")
    return "\n".join(lines)


def _session_block(
    session: OrbSessionState | None,
    *,
    thread_message_count: int,
    session_has_prior_turn: bool,
) -> str:
    if session is None:
        return (
            f"SESSION:\n"
            f"- thread_message_count: {thread_message_count}\n"
            f"- has_prior_turn: {session_has_prior_turn}\n"
            f"- (no orb session yet)\n"
        )
    goal = session.active_goal or {}
    return (
        f"SESSION:\n"
        f"- thread_message_count: {thread_message_count}\n"
        f"- has_prior_turn: {session_has_prior_turn}\n"
        f"- last_tool: {session.last_tool or '(none)'}\n"
        f"- route_kind: {session.route_kind or '(none)'}\n"
        f"- route_reason: {getattr(session, 'route_reason', None) or '(none)'}\n"
        f"- last_transcript: {(session.last_transcript or '')[:400]}\n"
        f"- last_answer: {(session.last_answer or '')[:600]}\n"
        f"- active_goal_status: {goal.get('status') or '(none)'}\n"
        f"- active_goal_objective: {(str(goal.get('objective') or ''))[:400]}\n"
        f"- pending_user_goal: {(session.pending_user_goal or '')[:200]}\n"
    )


def parse_route_response(data: dict[str, Any]) -> RouteDecision:
    """Map LLM JSON to RouteDecision; invalid tool names are dropped."""
    kind = str(data.get("kind") or "ask_briefly").strip().lower()
    if kind not in _ROUTE_KINDS:
        kind = "ask_briefly"

    raw_tools = data.get("tools") or []
    if not isinstance(raw_tools, list):
        raw_tools = []

    tools: list[OrbTool] = []
    seen: set[str] = set()
    for name in raw_tools:
        tool_name = str(name or "").strip()
        if not tool_name or tool_name in seen:
            continue
        tool = _BY_NAME.get(tool_name)
        if tool is not None:
            tools.append(tool)
            seen.add(tool_name)

    reason = str(data.get("reason") or "llm_route").strip()[:120] or "llm_route"
    try:
        confidence = float(data.get("confidence") or 0.85)
    except (TypeError, ValueError):
        confidence = 0.85
    confidence = max(0.0, min(1.0, confidence))

    clarifying_question = str(data.get("clarifying_question") or "").strip() or None

    if kind == "direct":
        if not tools:
            return RouteDecision(
                kind="ask_briefly",
                confidence=confidence,
                reason="llm_direct_no_tool",
            )
        return RouteDecision(
            kind="direct",
            tools=(tools[0],),
            confidence=confidence,
            reason=reason,
            clarifying_question=clarifying_question,
        )

    if kind == "agent":
        if not tools:
            return RouteDecision(
                kind="ask_briefly",
                confidence=confidence,
                reason="llm_agent_no_tools",
            )
        return RouteDecision(
            kind="agent",
            tools=tuple(tools[:3]),
            confidence=confidence,
            reason=reason,
            clarifying_question=clarifying_question,
        )

    if kind == "clarify":
        return RouteDecision(
            kind="clarify",
            confidence=confidence,
            reason=reason or "needs_clarification",
            clarifying_question=clarifying_question,
        )

    return RouteDecision(
        kind="ask_briefly",
        confidence=confidence,
        reason=reason,
        clarifying_question=clarifying_question,
    )


async def classify_intent_with_llm(
    transcript: str,
    *,
    thread_message_count: int = 0,
    session: OrbSessionState | None = None,
    session_has_prior_turn: bool = False,
    user_id: str | None = None,
) -> RouteDecision:
    text = (transcript or "").strip()
    if not text:
        return RouteDecision(kind="ask_briefly", reason="empty")

    user_prompt = (
        f"TOOL CATALOG:\n{render_tool_catalog()}\n\n"
        f"{_session_block(session, thread_message_count=thread_message_count, session_has_prior_turn=session_has_prior_turn)}\n"
        f"USER UTTERANCE:\n{text}\n\n"
        f"{_INSTRUCTIONS}"
    )

    settings = get_settings()
    llm = get_llm_adapter()
    try:
        data = await llm.complete_json(
            [Message(role="user", content=user_prompt)],
            system=_SYSTEM,
            model=settings.orb_intent_model or None,
            max_tokens=settings.orb_intent_max_tokens,
            user_id=user_id,
            agent="orb_intent",
        )
    except Exception:
        log.exception("orb LLM intent classification failed")
        return RouteDecision(kind="ask_briefly", reason="llm_route_failed")

    if not isinstance(data, dict):
        return RouteDecision(kind="ask_briefly", reason="llm_invalid_response")

    decision = parse_route_response(data)
    log.debug(
        "orb LLM intent → kind=%s reason=%s tools=%s",
        decision.kind,
        decision.reason,
        [t.name for t in decision.tools],
    )
    return decision
