"""
Unified orb turn execution — single path for HTTP, SSE, and WebSocket.

All routes stream spoken text as deltas when possible so TTS starts early and
uses one consistent pipeline on the client.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import time
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.agent import AgentRuntime, ToolContext, ToolRegistry, from_orb_tool
from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import User
from briefly_api.services.ask_briefly import ask_briefly, iter_ask_briefly_events
from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_context import load_orb_tool_context, update_tool_slots_from_turn
from briefly_api.services.orb_goal import (
    agent_goal_text,
    agent_history_from_goal,
    is_compound_goal,
    should_resume_goal,
    start_goal,
    step_label,
    sync_goal_from_result,
)
from briefly_api.services.orb_persona import chunk_for_streaming, polish_spoken_answer
from briefly_api.services.orb_voice_interaction import (
    detect_clarification,
    merge_clarification_follow_up,
    spoken_acknowledgment,
    spoken_agent_narration,
)
from briefly_api.services.orb_router import RouteDecision
from briefly_api.services.orb_session import OrbSessionState, update_session_after_turn
from briefly_api.services.orb_tools import OrbTool

log = logging.getLogger(__name__)

ASK_TOOL_NAME = "ask_briefly"

_COMPOSE_REPORT_PROGRESS: tuple[str, ...] = (
    "I'm searching the web and your saved articles — this usually takes about half a minute.",
    "Still pulling sources together for your report…",
    "Almost done — finishing up your report now.",
)


def _tool_trace(outputs: list[dict]) -> list[dict]:
    return [
        {
            "tool": o.get("tool"),
            "ok": o.get("ok", True),
            "answer_chars": len(str(o.get("answer") or "")),
        }
        for o in outputs
    ]


def _voice_agent_steps(surface: str) -> int:
    s = get_settings()
    cap = s.orb_voice_max_steps
    if surface in {"desktop", "mobile", "mobile_web"}:
        return min(s.agent_max_steps, cap)
    return s.agent_max_steps


def _agent_registry() -> ToolRegistry:
    from briefly_api.services.orb import ASK_TOOL, REGISTRY
    from briefly_api.agent.plugins import load_plugin_tools

    registry = ToolRegistry([from_orb_tool(t) for t in REGISTRY])
    load_plugin_tools(registry)
    return registry


async def _iter_voice_agent_turn(
    db: AsyncSession,
    user: User,
    transcript: str,
    *,
    thread_id: str | None,
    content_id: str | None,
    surface: str,
    session: OrbSessionState | None = None,
    route_reason: str = "",
) -> AsyncIterator[dict]:
    """Stream agent steps, answer deltas, and a final complete payload."""
    settings = get_settings()
    steps_cap = _voice_agent_steps(surface)
    if session:
        goal = session.active_goal
        if is_compound_goal(transcript) and (not goal or goal.get("status") != "awaiting_confirm"):
            start_goal(session, transcript)
        elif should_resume_goal(session, transcript) and goal:
            goal["status"] = "active"

    goal_text = agent_goal_text(session, transcript)
    history = agent_history_from_goal(session)
    runtime = AgentRuntime(_agent_registry(), max_steps=steps_cap, allow_writes=True)
    ctx = ToolContext(
        db=db,
        user=user,
        settings=settings,
        goal=goal_text,
        thread_id=thread_id,
        content_id=content_id,
        extra={"agent_history": history},
    )
    started = time.monotonic()
    result = None
    seen_tools: set[str] = set()
    try:
        async for event in runtime.iter_run(ctx):
            if event.get("type") == "agent_step":
                tool = event.get("tool")
                phase = event.get("phase") or "done"
                thought = str(event.get("thought") or "")
                narration = None
                if phase == "start":
                    narration = spoken_agent_narration(tool, thought, seen_tools=seen_tools)
                    if narration:
                        for chunk in chunk_for_streaming(narration):
                            yield {"type": "delta", "content": chunk}
                yield {
                    "type": "agent_step",
                    "n": event.get("n"),
                    "tool": tool,
                    "label": step_label(tool),
                    "thought": thought[:240] if thought else None,
                    "narration": narration,
                    "phase": phase,
                    "ok": event.get("ok"),
                }
            elif event.get("type") == "agent_result":
                result = event.get("result")
    except Exception:
        log.exception("orb voice agent failed")
        return

    if result is None:
        return

    duration_ms = int((time.monotonic() - started) * 1000)
    from briefly_api.services.orb import _persist_agent_run

    await _persist_agent_run(user.id, transcript, result, duration_ms)

    if session:
        sync_goal_from_result(
            session,
            session.active_goal.get("objective") if session.active_goal else transcript,
            steps=result.steps,
            stopped_reason=result.stopped_reason,
        )

    answer = polish_spoken_answer(result.answer or "")
    if not answer:
        return

    expects_reply = answer.endswith("?") or result.stopped_reason == "needs_confirmation"
    payload = {
        "transcript": transcript,
        "thread_id": result.thread_id or thread_id,
        "answer": answer,
        "citations": result.citations,
        "tool_trace": [{"tool": s.tool, "ok": s.ok} for s in result.steps if s.tool],
        "expects_reply": expects_reply,
        "route_kind": "agent",
        "route_reason": route_reason or result.stopped_reason,
        "agent_steps": len(result.steps),
        "agent_stopped": result.stopped_reason,
    }

    for chunk in chunk_for_streaming(answer):
        yield {"type": "delta", "content": chunk}
    yield {"type": "complete", **payload}


async def _run_voice_agent(
    db: AsyncSession,
    user: User,
    transcript: str,
    *,
    thread_id: str | None,
    content_id: str | None,
    surface: str,
    session: OrbSessionState | None = None,
    route_reason: str = "",
) -> dict | None:
    payload = None
    async for event in _iter_voice_agent_turn(
        db,
        user,
        transcript,
        thread_id=thread_id,
        content_id=content_id,
        surface=surface,
        session=session,
        route_reason=route_reason,
    ):
        if event.get("type") == "complete":
            payload = event
    if not payload:
        return None
    return {k: v for k, v in payload.items() if k != "type"}


async def _exec_tool(
    tool: OrbTool,
    db: AsyncSession,
    user: User,
    transcript: str,
    thread_id: str | None,
    content_id: str | None,
    args: dict | None = None,
    session: OrbSessionState | None = None,
) -> dict:
    ctx = await load_orb_tool_context(db, str(user.id), session, thread_id)
    kwargs: dict = {
        "transcript": transcript,
        "thread_id": thread_id,
        "content_id": content_id,
        "args": args,
    }
    if "orb_context" in inspect.signature(tool.handler).parameters:
        kwargs["orb_context"] = ctx
    out = await tool.handler(db, user, **kwargs)
    answer = polish_spoken_answer(str(out.get("answer") or ""))
    return {"tool": tool.name, **out, "answer": answer, "ok": True}


def _merge_session_context(
    session: OrbSessionState | None,
    tool_name: str | None,
    transcript: str,
    answer: str,
    out: dict | None = None,
) -> None:
    if session is None or not tool_name:
        return
    update_tool_slots_from_turn(session, tool_name, transcript, answer)
    extra = (out or {}).get("tool_slots")
    if isinstance(extra, dict):
        merged = dict(session.tool_slots or {})
        merged.update(extra)
        session.tool_slots = merged


async def execute_routed_turn(
    db: AsyncSession,
    user: User,
    transcript: str,
    *,
    decision: RouteDecision,
    thread_id: str | None,
    content_id: str | None,
    surface: str,
    session: OrbSessionState | None = None,
) -> dict:
    """Run a pre-classified route and return a turn payload."""
    resolved_thread = thread_id

    if decision.kind == "direct" and len(decision.tools) == 1:
        tool = decision.tools[0]
        if tool.name == ASK_TOOL_NAME:
            result_data = await ask_briefly(
                db, user, transcript, thread_id=thread_id, content_id=content_id, voice=True
            )
            assistant = result_data.get("assistant", {}) if isinstance(result_data, dict) else {}
            answer = polish_spoken_answer(str(assistant.get("content") or ""))
            return {
                "transcript": transcript,
                "thread_id": result_data.get("thread_id"),
                "answer": answer,
                "citations": assistant.get("citations", []),
                "tool_trace": [{"tool": ASK_TOOL_NAME, "ok": True}],
                "expects_reply": answer.endswith("?"),
                "route_kind": decision.kind,
                "route_reason": decision.reason,
            }
        out = await _exec_tool(tool, db, user, transcript, thread_id, content_id, session=session)
        if out.get("thread_id"):
            resolved_thread = out["thread_id"]
        _merge_session_context(session, tool.name, transcript, out.get("answer", ""), out)
        return {
            "transcript": transcript,
            "thread_id": out.get("thread_id") or resolved_thread,
            "answer": out.get("answer", ""),
            "citations": out.get("citations", []),
            "tool_trace": _tool_trace([out]),
            "expects_reply": bool(out.get("expects_reply")),
            "display": out.get("display"),
            "route_kind": decision.kind,
            "route_reason": decision.reason,
            "draft_id": out.get("draft_id"),
            "narrate_mode": bool(out.get("narrate_mode")),
        }

    if decision.kind == "agent":
        planned = await _run_voice_agent(
            db,
            user,
            transcript,
            thread_id=thread_id,
            content_id=content_id,
            surface=surface,
            session=session,
            route_reason=decision.reason,
        )
        if planned:
            planned["transcript"] = transcript
            planned.setdefault("route_kind", "agent")
            planned.setdefault("route_reason", decision.reason)
            return planned

    result_data = await ask_briefly(
        db, user, transcript, thread_id=thread_id, content_id=content_id, voice=True
    )
    assistant = result_data.get("assistant", {}) if isinstance(result_data, dict) else {}
    answer = polish_spoken_answer(str(assistant.get("content") or ""))
    return {
        "transcript": transcript,
        "thread_id": result_data.get("thread_id"),
        "answer": answer,
        "citations": assistant.get("citations", []),
        "tool_trace": [{"tool": ASK_TOOL_NAME, "ok": True}],
        "expects_reply": answer.endswith("?"),
        "route_kind": "ask_briefly",
        "route_reason": decision.reason or "fallback",
    }


def _log_turn(user_id: str | None, transcript: str, decision: RouteDecision, payload: dict, timings: dict) -> None:
    tools = [t.name for t in decision.tools] if decision.tools else []
    trace = payload.get("tool_trace") or []
    log.info(
        "orb_turn user=%s route=%s reason=%s tools=%s trace=%s ms=%s transcript=%r",
        user_id,
        payload.get("route_kind") or decision.kind,
        payload.get("route_reason") or decision.reason,
        tools,
        [t.get("tool") for t in trace],
        timings.get("total_ms"),
        (transcript or "")[:80],
    )


async def iter_orb_turn_events(
    db: AsyncSession | None,
    user: User | None,
    transcript: str,
    *,
    user_id: str | None = None,
    thread_id: str | None = None,
    content_id: str | None = None,
    session: OrbSessionState | None = None,
    session_id: str | None = None,
    surface: str = "desktop",
    timings: dict | None = None,
    started: float | None = None,
    thread_message_count: int = 0,
) -> AsyncIterator[dict]:
    """Stream turn events: meta → deltas → complete."""
    from briefly_api.services.ask_briefly import _load_user_for_ask
    from briefly_api.services.orb import _persist_orb_exchange, _thread_message_count

    timings = timings if timings is not None else {}
    started = started if started is not None else time.monotonic()
    uid = user_id or (str(user.id) if user and getattr(user, "id", None) else None)

    if uid and (user is None or db is None):
        from briefly_api.services.ask_briefly import _load_user_for_ask

        async with SessionLocal() as session_db:
            loaded_user = await _load_user_for_ask(session_db, uid)
            async for event in iter_orb_turn_events(
                session_db,
                loaded_user,
                transcript,
                user_id=uid,
                thread_id=thread_id,
                content_id=content_id,
                session=session,
                session_id=session_id,
                surface=surface,
                timings=timings,
                started=started,
            ):
                yield event
        return

    resolved_thread = thread_id or (session.thread_id if session else None)
    user_transcript = (transcript or "").strip()
    effective_transcript = merge_clarification_follow_up(user_transcript, session)

    route_started = time.monotonic()
    decision = RouteDecision(kind="ask_briefly", reason="no_user")
    if uid and db is not None and user is not None:
        if thread_message_count == 0:
            thread_message_count = await _thread_message_count(db, uid, resolved_thread)
        decision = await classify_orb_intent(
            effective_transcript,
            thread_message_count=thread_message_count,
            session=session,
            session_thread_id=session.thread_id if session else None,
            session_has_prior_turn=bool(session and session.last_transcript),
        )
    timings["route_ms"] = int((time.monotonic() - route_started) * 1000)

    yield {
        "type": "meta",
        "transcript": user_transcript,
        "effective_transcript": effective_transcript if effective_transcript != user_transcript else None,
        "session_id": session.session_id if session else session_id,
        "thread_id": resolved_thread,
        "route_kind": decision.kind,
        "route_reason": decision.reason,
        "route_tools": [t.name for t in decision.tools],
        "timings": timings,
    }

    clarify = detect_clarification(effective_transcript, decision, session=session)
    if clarify:
        timings["total_ms"] = int((time.monotonic() - started) * 1000)
        answer = polish_spoken_answer(clarify)
        for chunk in chunk_for_streaming(answer):
            yield {"type": "delta", "content": chunk}
        complete = {
            "type": "complete",
            "transcript": user_transcript,
            "thread_id": resolved_thread,
            "session_id": session.session_id if session else session_id,
            "answer": answer,
            "citations": [],
            "tool_trace": [],
            "expects_reply": True,
            "route_kind": "clarify",
            "route_reason": "needs_clarification",
            "timings": timings,
        }
        if session:
            await update_session_after_turn(
                session,
                transcript=user_transcript,
                route_kind="clarify",
                route_reason="needs_clarification",
                last_answer=answer[:4000],
                pending_user_goal=effective_transcript,
            )
        _log_turn(uid, effective_transcript, decision, complete, timings)
        yield complete
        return

    ack = spoken_acknowledgment(effective_transcript, decision)
    if ack:
        for chunk in chunk_for_streaming(ack):
            yield {"type": "delta", "content": chunk}

    stream_rag = decision.kind == "ask_briefly" or (
        decision.kind == "direct"
        and len(decision.tools) == 1
        and decision.tools[0].name == ASK_TOOL_NAME
    )

    if stream_rag and uid:
        ask_user = user
        if ask_user is None:
            async with SessionLocal() as ask_db:
                ask_user = await _load_user_for_ask(ask_db, uid)

        stream_thread_id = resolved_thread
        answer_parts: list[str] = []
        citations: list = []
        async for event in iter_ask_briefly_events(
            db,
            ask_user,
            effective_transcript,
            thread_id=stream_thread_id,
            content_id=content_id,
            voice=True,
        ):
            event_type = event.get("type")
            if event_type == "thread_id" and event.get("thread_id"):
                stream_thread_id = event["thread_id"]
                if session:
                    session.thread_id = stream_thread_id
                    await update_session_after_turn(session, thread_id=stream_thread_id)
            elif event_type == "delta":
                delta = str(event.get("content") or "")
                if delta:
                    answer_parts.append(delta)
                    yield {"type": "delta", "content": delta}
            elif event_type == "done":
                citations = event.get("citations") or []
                if event.get("answer"):
                    answer_parts = [str(event["answer"])]

        answer = polish_spoken_answer("".join(answer_parts))
        timings["total_ms"] = int((time.monotonic() - started) * 1000)
        complete = {
            "type": "complete",
            "transcript": user_transcript,
            "thread_id": stream_thread_id,
            "session_id": session.session_id if session else session_id,
            "answer": answer,
            "citations": citations,
            "tool_trace": [{"tool": ASK_TOOL_NAME, "ok": True}],
            "expects_reply": bool(answer.endswith("?")),
            "route_kind": "ask_briefly",
            "route_reason": decision.reason,
            "timings": timings,
        }
        if session:
            tool_name = ASK_TOOL_NAME
            await update_session_after_turn(
                session,
                thread_id=stream_thread_id,
                transcript=user_transcript,
                last_tool=tool_name,
                route_kind="ask_briefly",
                route_reason=decision.reason,
                last_answer=answer[:4000],
                pending_user_goal=None,
            )
            if db is not None and user is not None:
                persisted = await _persist_orb_exchange(
                    db, uid, stream_thread_id, effective_transcript, answer, citations=citations
                )
                if persisted:
                    complete["thread_id"] = persisted
        _log_turn(uid, effective_transcript, decision, complete, timings)
        yield complete
        return

    if decision.kind == "agent" and db is not None and user is not None and uid:
        exec_started = time.monotonic()
        complete = None
        async for event in _iter_voice_agent_turn(
            db,
            user,
            effective_transcript,
            thread_id=resolved_thread,
            content_id=content_id,
            surface=surface,
            session=session,
            route_reason=decision.reason,
        ):
            et = event.get("type")
            if et == "agent_step":
                yield event
            elif et == "delta":
                yield event
            elif et == "complete":
                complete = event

        timings["agent_ms"] = int((time.monotonic() - exec_started) * 1000)
        timings["total_ms"] = int((time.monotonic() - started) * 1000)
        if complete is None:
            log.warning("orb agent produced no answer; falling back to ask_briefly")
            decision = RouteDecision(kind="ask_briefly", reason="agent_empty_fallback")
        else:
            complete["timings"] = timings
            complete["session_id"] = session.session_id if session else session_id
            complete["transcript"] = user_transcript
            answer = complete.get("answer") or ""
            tool_name = None
            trace = complete.get("tool_trace") or []
            if trace:
                tool_name = trace[0].get("tool")

            if session:
                await update_session_after_turn(
                    session,
                    thread_id=complete.get("thread_id"),
                    transcript=user_transcript,
                    last_tool=tool_name,
                    route_kind="agent",
                    route_reason=str(complete.get("route_reason") or decision.reason or ""),
                    last_answer=str(answer)[:4000],
                    tool_slots=dict(session.tool_slots or {}),
                    active_goal=session.active_goal,
                    pending_user_goal=None,
                )
            persisted = await _persist_orb_exchange(
                db,
                uid,
                complete.get("thread_id") or resolved_thread,
                effective_transcript,
                answer,
                citations=complete.get("citations") or [],
            )
            if persisted:
                complete["thread_id"] = persisted

            _log_turn(uid, effective_transcript, decision, complete, timings)
            yield complete
            return

    if db is None or user is None or not uid:
        raise ValueError("Voice turn unavailable.")

    if (
        decision.kind == "direct"
        and len(decision.tools) == 1
        and decision.tools[0].name == "compose_report"
    ):
        narr = spoken_agent_narration("compose_report", "", seen_tools=set())
        if narr:
            for chunk in chunk_for_streaming(narr):
                yield {"type": "delta", "content": chunk}

    exec_started = time.monotonic()
    is_compose_report = (
        decision.kind == "direct"
        and len(decision.tools) == 1
        and decision.tools[0].name == "compose_report"
    )
    if is_compose_report:
        task = asyncio.create_task(
            execute_routed_turn(
                db,
                user,
                effective_transcript,
                decision=decision,
                thread_id=resolved_thread,
                content_id=content_id,
                surface=surface,
                session=session,
            )
        )
        tick_idx = 0
        while not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=10.0)
                break
            except asyncio.TimeoutError:
                msg = _COMPOSE_REPORT_PROGRESS[
                    min(tick_idx, len(_COMPOSE_REPORT_PROGRESS) - 1)
                ]
                tick_idx += 1
                yield {"type": "status", "message": msg}
                for chunk in chunk_for_streaming(msg):
                    yield {"type": "delta", "content": chunk}
        payload = await task
    else:
        payload = await execute_routed_turn(
            db,
            user,
            effective_transcript,
            decision=decision,
            thread_id=resolved_thread,
            content_id=content_id,
            surface=surface,
            session=session,
        )
    timings["agent_ms"] = int((time.monotonic() - exec_started) * 1000)
    timings["total_ms"] = int((time.monotonic() - started) * 1000)
    payload["timings"] = timings
    payload["session_id"] = session.session_id if session else session_id
    payload["transcript"] = user_transcript

    answer = payload.get("answer") or ""
    spoken_max = 8000 if payload.get("narrate_mode") else 2400
    answer = polish_spoken_answer(answer, max_chars=spoken_max)
    for chunk in chunk_for_streaming(answer):
        yield {"type": "delta", "content": chunk}

    complete = {"type": "complete", **payload, "answer": answer}
    tool_name = None
    trace = payload.get("tool_trace") or []
    if trace:
        tool_name = trace[0].get("tool")

    if session:
        await update_session_after_turn(
            session,
            thread_id=payload.get("thread_id"),
            transcript=user_transcript,
            draft_id=payload.get("draft_id"),
            last_tool=tool_name,
            route_kind=str(payload.get("route_kind") or decision.kind),
            route_reason=str(payload.get("route_reason") or decision.reason or ""),
            last_answer=str(payload.get("answer") or "")[:4000],
            tool_slots=dict(session.tool_slots or {}),
            active_goal=session.active_goal,
            pending_user_goal=None,
        )
    persisted = await _persist_orb_exchange(
        db,
        uid,
        payload.get("thread_id") or resolved_thread,
        effective_transcript,
        answer,
        citations=payload.get("citations") or [],
    )
    if persisted:
        complete["thread_id"] = persisted

    _log_turn(uid, effective_transcript, decision, complete, timings)
    yield complete
