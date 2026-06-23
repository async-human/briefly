"""
briefly_api/services/orb.py

Orchestration for the voice orb. One "turn" is: audio in → STT → route to a tool
(or the Ask Briefly brain) → text answer + citations. The client plays the
answer via /orb/speak (TTS) so playback streams independently of reasoning.

Routing is fast by default. Tools are declared once in `orb_tools.py`; here we
only decide *which* to run:

  - exactly one tool's fast-pattern matches  → run it directly (no planner call)
  - no tool matches (an open question)        → Ask Briefly directly (no planner)
  - two or more tools match (mixed intent)    → LLM planner decides + synthesizes

So the planner LLM round-trip — pure overhead on the common path — only happens
for genuinely ambiguous multi-intent turns. STT + brain are the only LLM hops
for the everyday "answer my question" / "read my brief" cases.

Everything reuses provider-agnostic pieces: STT (stt.adapter), brain
(ask_briefly), TTS (tts.adapter via the /orb/speak route).
"""
from __future__ import annotations

import json
import logging
import time

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.engine import SessionLocal

from briefly_api.agent import AgentRuntime, ToolContext, ToolRegistry, from_orb_tool
from briefly_api.config import get_settings
from briefly_api.db.models import User
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.ask_briefly import ask_briefly
from briefly_api.services.orb_tools import DATA_TOOLS, OrbTool
from briefly_api.stt.adapter import get_stt_adapter

log = logging.getLogger(__name__)

_MAX_TOOL_STEPS = 3


# ── Ask Briefly as a registry tool ───────────────────────────────────────────
# Defined here (not in orb_tools) so it calls the module-level `ask_briefly`,
# which tests monkeypatch and which is the single source of brain behaviour.


async def _ask_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str,
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    result = await ask_briefly(db, user, transcript, thread_id=thread_id, content_id=content_id)
    assistant = result.get("assistant", {}) if isinstance(result, dict) else {}
    return {
        "answer": assistant.get("content", ""),
        "citations": assistant.get("citations", []),
        "thread_id": result.get("thread_id") if isinstance(result, dict) else None,
    }


ASK_TOOL = OrbTool(
    name="ask_briefly",
    description="General-purpose question answering over the user's corpus, with citations.",
    handler=_ask_handler,
)

REGISTRY: list[OrbTool] = [*DATA_TOOLS, ASK_TOOL]
_BY_NAME: dict[str, OrbTool] = {t.name: t for t in REGISTRY}


# ── Execution helpers ────────────────────────────────────────────────────────


async def _exec_tool(
    tool: OrbTool,
    db: AsyncSession,
    user: User,
    transcript: str,
    thread_id: str | None,
    content_id: str | None,
    args: dict | None = None,
) -> dict:
    out = await tool.handler(
        db, user, transcript=transcript, thread_id=thread_id, content_id=content_id, args=args
    )
    return {"tool": tool.name, **out}


def _merge_citations(tool_outputs: list[dict]) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    merged: list[dict] = []
    for out in tool_outputs:
        for c in out.get("citations", []) or []:
            key = (str(c.get("content_id") or ""), str(c.get("title") or ""))
            if key in seen:
                continue
            seen.add(key)
            merged.append(c)
    return merged


def _tool_trace(tool_outputs: list[dict]) -> list[dict]:
    return [
        {
            "tool": out.get("tool"),
            "answer_chars": len(str(out.get("answer") or "")),
            "citations_count": len(out.get("citations") or []),
        }
        for out in tool_outputs
    ]


def _single_result(transcript: str, out: dict) -> dict:
    return {
        "transcript": transcript,
        "thread_id": out.get("thread_id"),
        "answer": out.get("answer", ""),
        "citations": out.get("citations", []),
        "tool_trace": _tool_trace([out]),
        "expects_reply": bool(out.get("expects_reply")),
    }


# ── LLM planner (only for ambiguous multi-intent turns) ──────────────────────


async def _llm_plan_and_execute(
    db: AsyncSession,
    user: User,
    transcript: str,
    *,
    thread_id: str | None,
    content_id: str | None,
) -> dict | None:
    if db is None or not getattr(user, "id", None):
        return None

    llm = get_llm_adapter()
    tool_lines = "\n".join(f"- {t.name}: {t.description}" for t in REGISTRY)
    planner_system = (
        "You are OrbPlanner. Select tools for a spoken assistant turn.\n"
        'Return strict JSON: {"steps":[{"tool":"...","why":"..."}]}.\n'
        f"Allowed tools: {', '.join(t.name for t in REGISTRY)}.\n"
        "Use ask_briefly (the user's own sources) for open-ended questions — it is the default.\n"
        "Use web_search ONLY for explicit open-web requests or current external facts the corpus can't cover.\n"
        f"Max {_MAX_TOOL_STEPS} steps."
    )
    planner_user = f"User transcript: {transcript}\n\nTools:\n{tool_lines}"
    try:
        plan = await llm.complete_json(
            [Message(role="user", content=planner_user)],
            system=planner_system,
            max_tokens=220,
            user_id=user.id,
            agent="orb_planner",
        )
    except Exception as exc:  # noqa: BLE001
        log.debug("orb planner fallback: %s", exc)
        return None

    raw_steps = plan.get("steps") if isinstance(plan, dict) else None
    if not isinstance(raw_steps, list) or not raw_steps:
        return None

    steps: list[tuple[str, dict | None]] = []
    for step in raw_steps[:_MAX_TOOL_STEPS]:
        if not isinstance(step, dict):
            continue
        name = str(step.get("tool") or "").strip()
        if name in _BY_NAME:
            args = step.get("args") if isinstance(step.get("args"), dict) else None
            steps.append((name, args))
    if not steps:
        return None

    tool_outputs: list[dict] = []
    resolved_thread = thread_id
    for name, args in steps:
        out = await _exec_tool(_BY_NAME[name], db, user, transcript, resolved_thread, content_id, args)
        if out.get("thread_id"):
            resolved_thread = out["thread_id"]
        tool_outputs.append(out)

    if len(tool_outputs) == 1:
        only = tool_outputs[0]
        return {
            "thread_id": only.get("thread_id") or resolved_thread,
            "answer": only.get("answer", ""),
            "citations": only.get("citations", []),
            "tool_trace": _tool_trace(tool_outputs),
        }

    # Multiple tools → synthesize one concise spoken answer.
    synthesis_system = (
        "You are Briefly Orb. Synthesize multiple tool outputs into one concise spoken answer.\n"
        'Return strict JSON: {"answer":"..."}. Keep it practical and direct.'
    )
    synthesis_payload = {
        "user_query": transcript,
        "tool_outputs": [
            {"tool": o.get("tool"), "answer": o.get("answer", ""), "citations": o.get("citations", [])}
            for o in tool_outputs
        ],
    }
    final_answer = ""
    try:
        synth = await llm.complete_json(
            [Message(role="user", content=json.dumps(synthesis_payload, ensure_ascii=False))],
            system=synthesis_system,
            max_tokens=320,
            user_id=user.id,
            agent="orb_synthesizer",
        )
        if isinstance(synth, dict):
            final_answer = str(synth.get("answer") or "").strip()
    except Exception as exc:  # noqa: BLE001
        log.debug("orb synthesis fallback: %s", exc)
    if not final_answer:
        final_answer = " ".join(
            part for part in (str(o.get("answer", "")).strip() for o in tool_outputs) if part
        ).strip()
    return {
        "thread_id": resolved_thread,
        "answer": final_answer,
        "citations": _merge_citations(tool_outputs),
        "tool_trace": _tool_trace(tool_outputs),
    }


# ── Agent runtime (the live brain for tasks) ─────────────────────────────────
# A task — any act/write tool or a compound multi-tool goal — runs through the
# plan→execute→observe loop: it picks tools, chains them, and asks the user a
# follow-up only when information is genuinely missing. Quick single reads skip
# this (they go direct) so voice latency stays low.


def _agent_registry() -> ToolRegistry:
    return ToolRegistry([from_orb_tool(t) for t in REGISTRY])


async def _persist_agent_run(
    user_id: str, goal: str, result, duration_ms: int
) -> None:
    """Write the audit record for an agent run on its own session, so auditing never
    affects or depends on the request transaction. Best-effort — never raises."""
    from briefly_api.db.models import AgentRun

    try:
        async with SessionLocal() as session:
            session.add(
                AgentRun(
                    user_id=user_id,
                    surface="orb",
                    goal=(goal or "")[:2000],
                    answer=(result.answer or "")[:4000],
                    tools_used=list(result.tools_used or []),
                    stopped_reason=result.stopped_reason,
                    steps=[s.to_dict() for s in result.steps],
                    thread_id=result.thread_id,
                    duration_ms=duration_ms,
                )
            )
            await session.commit()
    except Exception:
        log.exception("agent run audit persist failed for user %s", user_id)


async def _run_agent(
    db: AsyncSession,
    user: User,
    transcript: str,
    *,
    thread_id: str | None,
    content_id: str | None,
) -> dict | None:
    settings = get_settings()
    runtime = AgentRuntime(_agent_registry(), max_steps=settings.agent_max_steps, allow_writes=True)
    ctx = ToolContext(
        db=db,
        user=user,
        settings=settings,
        goal=transcript,
        thread_id=thread_id,
        content_id=content_id,
    )
    started = time.monotonic()
    try:
        result = await runtime.run(ctx)
    except Exception:
        log.exception("orb agent runtime failed — falling back")
        return None
    duration_ms = int((time.monotonic() - started) * 1000)

    await _persist_agent_run(user.id, transcript, result, duration_ms)

    answer = (result.answer or "").strip()
    if not answer:
        return None
    # The agent is waiting on the user if it asked a question or paused for confirmation.
    expects_reply = answer.endswith("?") or result.stopped_reason == "needs_confirmation"
    return {
        "thread_id": result.thread_id or thread_id,
        "answer": answer,
        "citations": result.citations,
        "tool_trace": [{"tool": s.tool, "ok": s.ok} for s in result.steps if s.tool],
        "expects_reply": expects_reply,
    }


# ── Public entrypoint ────────────────────────────────────────────────────────


async def run_orb_turn(
    db: AsyncSession,
    user: User,
    *,
    audio_bytes: bytes | None = None,
    filename: str = "speech.webm",
    content_type: str = "audio/webm",
    text: str | None = None,
    thread_id: str | None = None,
    content_id: str | None = None,
) -> dict:
    """
    One voice turn. Provide either spoken `audio_bytes` (transcribed first) or
    typed `text`. Returns the transcript plus a grounded answer + citations.
    """
    transcript = (text or "").strip()

    if audio_bytes:
        stt = get_stt_adapter()
        transcript = (
            await stt.transcribe(audio_bytes, filename=filename, content_type=content_type)
        ).strip()

    if not transcript:
        raise ValueError("No speech detected — try again.")

    # ── Routing ──────────────────────────────────────────────────────────────
    if db is not None and getattr(user, "id", None):
        matched = [t for t in DATA_TOOLS if t.matches(transcript)]

        # A single clear intent (read OR act) → run the handler directly. No planner
        # hop, so it's fast AND the handler's own conversational reply (e.g. the
        # draft read-back + "want changes or should I send it?") reaches the user
        # intact. Most turns take this path.
        if len(matched) == 1:
            out = await _exec_tool(matched[0], db, user, transcript, thread_id, content_id)
            return _single_result(transcript, out)

        # Genuinely compound/ambiguous goal (2+ tools) → the agent runtime plans,
        # chains tools, and asks a follow-up only when information is missing.
        if len(matched) >= 2:
            planned = await _run_agent(
                db, user, transcript, thread_id=thread_id, content_id=content_id
            )
            if planned is not None:
                return {"transcript": transcript, **planned}
            # Runtime unavailable → legacy one-shot planner, then the brain.
            planned = await _llm_plan_and_execute(
                db, user, transcript, thread_id=thread_id, content_id=content_id
            )
            if planned is not None:
                return {"transcript": transcript, **planned}

    # ── Default: straight to the brain (open questions, no context, fallthrough)
    result = await ask_briefly(db, user, transcript, thread_id=thread_id, content_id=content_id)
    assistant = result.get("assistant", {}) if isinstance(result, dict) else {}
    return {
        "transcript": transcript,
        "thread_id": result.get("thread_id") if isinstance(result, dict) else None,
        "answer": assistant.get("content", ""),
        "citations": assistant.get("citations", []),
        "tool_trace": [{"tool": "ask_briefly"}],
    }
