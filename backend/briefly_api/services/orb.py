"""
briefly_api/services/orb.py

Orchestration for the voice orb: a single "turn" chains the speech layer to the
Ask Briefly brain — audio in → STT → Ask Briefly (RAG over the user's corpus
with citations) → text answer. The client then plays the answer via /orb/speak
(TTS), so playback can stream independently of reasoning.

Everything here reuses existing, provider-agnostic pieces:
  - STT  → stt.adapter (local faster-whisper / self-hosted / cloud)
  - brain → services.ask_briefly (retrieval + LLM + citations)
  - TTS  → tts.adapter (local Kokoro / self-hosted / cloud)
"""
from __future__ import annotations

import logging
import re
import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import Digest, DigestItem, User
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.ask_briefly import ask_briefly
from briefly_api.services.browser_capture import list_recent_captures
from briefly_api.stt.adapter import get_stt_adapter

log = logging.getLogger(__name__)

_TODAY_BRIEF_RE = re.compile(r"(?:today(?:'s)?\s+(?:brief|briefing|briefs)|brief(?:ing)?\s+today)", re.IGNORECASE)
_PROACTIVE_RE = re.compile(r"(?:anything\s+important|proactive|alerts?|urgent|what\s+should\s+i\s+know)", re.IGNORECASE)
_SAVED_RE = re.compile(r"(?:saved|unread|reading\s+list|backlog|queue)", re.IGNORECASE)
_MAX_TOOL_STEPS = 3


async def _tool_today_brief(db: AsyncSession, user_id: str) -> dict | None:
    today = datetime.now(timezone.utc).date().isoformat()
    digest_row = await db.execute(
        select(Digest).where(Digest.user_id == user_id, Digest.digest_date == today)
    )
    digest = digest_row.scalar_one_or_none()
    if not digest:
        return {
            "answer": "Your briefing for today is not ready yet. Ask me again in a few minutes.",
            "citations": [],
        }
    items_row = await db.execute(
        select(DigestItem)
        .where(DigestItem.digest_id == digest.id)
        .order_by(DigestItem.position.asc())
        .limit(5)
    )
    items = items_row.scalars().all()
    if not items:
        return {
            "answer": "Your briefing exists but has no items yet. It may still be generating.",
            "citations": [],
        }
    lines = ["Here are the top items in your briefing today:"]
    cites: list[dict] = []
    for i, it in enumerate(items, start=1):
        lines.append(f"{i}. {it.headline}")
        cites.append(
            {
                "ref": f"S{i}",
                "content_id": it.content_id or f"digest-item:{it.id}",
                "title": it.headline,
                "url": it.source_url,
                "source_name": it.source_name,
                "snippet": (it.summary or "")[:280],
                "kind": "today_brief",
            }
        )
    return {"answer": " ".join(lines), "citations": cites}


async def _tool_proactive(db: AsyncSession, user_id: str) -> dict:
    from briefly_api.agents.proactive.proactive_surfacing import get_for_api

    events = await get_for_api(db, user_id)
    if not events:
        return {
            "answer": "No urgent proactive updates right now. I'll surface important changes when they appear.",
            "citations": [],
        }
    top = sorted(events, key=lambda e: int(e.get("priority") or 0), reverse=True)[:3]
    lines = ["Here are the most important updates right now:"]
    cites: list[dict] = []
    for i, ev in enumerate(top, start=1):
        lines.append(f"{i}. {ev.get('title')}: {ev.get('body')}")
        cites.append(
            {
                "ref": f"S{i}",
                "content_id": ev.get("id", ""),
                "title": ev.get("title", "Proactive event"),
                "url": None,
                "source_name": "Proactive",
                "snippet": str(ev.get("body") or "")[:280],
                "kind": "proactive_event",
            }
        )
    return {"answer": " ".join(lines), "citations": cites}


async def _tool_saved_queue(db: AsyncSession, user_id: str) -> dict:
    captures = await list_recent_captures(db, user_id, limit=5)
    if not captures:
        return {"answer": "Your saved queue is clear — there are no unread items right now.", "citations": []}
    lines = ["You have saved items waiting:"]
    cites: list[dict] = []
    for i, cap in enumerate(captures, start=1):
        lines.append(f"{i}. {cap.title}")
        cites.append(
            {
                "ref": f"S{i}",
                "content_id": cap.id,
                "title": cap.title,
                "url": cap.url,
                "source_name": "Saved",
                "snippet": (cap.summary or "")[:280],
                "kind": "saved_item",
            }
        )
    return {"answer": " ".join(lines), "citations": cites}


async def _run_orb_tools(db: AsyncSession, user_id: str, transcript: str) -> dict | None:
    text = transcript.strip()
    if _TODAY_BRIEF_RE.search(text):
        return await _tool_today_brief(db, user_id)
    if _PROACTIVE_RE.search(text):
        return await _tool_proactive(db, user_id)
    if _SAVED_RE.search(text):
        return await _tool_saved_queue(db, user_id)
    return None


_TOOL_DESCRIPTIONS = {
    "today_brief": "Fetch today's briefing items and summarize key headlines.",
    "saved_queue": "Fetch saved/unread queue items the user has not read.",
    "proactive_events": "Fetch high-priority proactive events to surface now.",
    "ask_briefly": "General-purpose RAG question answering over the user's corpus.",
}


async def _run_tool_by_name(
    name: str,
    *,
    db: AsyncSession,
    user: User,
    transcript: str,
    thread_id: str | None,
    content_id: str | None,
) -> dict:
    if name == "today_brief":
        out = await _tool_today_brief(db, user.id) or {"answer": "", "citations": []}
        return {"tool": name, **out}
    if name == "saved_queue":
        return {"tool": name, **(await _tool_saved_queue(db, user.id))}
    if name == "proactive_events":
        return {"tool": name, **(await _tool_proactive(db, user.id))}
    if name == "ask_briefly":
        result = await ask_briefly(
            db,
            user,
            transcript,
            thread_id=thread_id,
            content_id=content_id,
        )
        assistant = result.get("assistant", {}) if isinstance(result, dict) else {}
        return {
            "tool": name,
            "answer": assistant.get("content", ""),
            "citations": assistant.get("citations", []),
            "thread_id": result.get("thread_id") if isinstance(result, dict) else None,
        }
    return {"tool": name, "answer": "", "citations": []}


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
    trace: list[dict] = []
    for out in tool_outputs:
        trace.append(
            {
                "tool": out.get("tool"),
                "answer_chars": len(str(out.get("answer") or "")),
                "citations_count": len(out.get("citations") or []),
            }
        )
    return trace


async def _llm_plan_and_execute(
    db: AsyncSession,
    user: User,
    transcript: str,
    *,
    thread_id: str | None,
    content_id: str | None,
) -> dict | None:
    # Guardrails for tests/mocks or partial contexts.
    if db is None or not getattr(user, "id", None):
        return None

    llm = get_llm_adapter()
    planner_system = (
        "You are OrbPlanner. Select tools for a spoken assistant turn.\n"
        "Return strict JSON: {\"steps\":[{\"tool\":\"...\",\"why\":\"...\"}],\"final_mode\":\"direct|synthesize\"}.\n"
        "Allowed tools: today_brief, saved_queue, proactive_events, ask_briefly.\n"
        "Rules:\n"
        "- If user asks about today's brief/briefing, include today_brief first.\n"
        "- If user asks about important updates/alerts, include proactive_events.\n"
        "- If user asks about saved/unread/queue, include saved_queue.\n"
        "- Use ask_briefly for open-ended questions.\n"
        f"- Max {_MAX_TOOL_STEPS} steps."
    )
    planner_user = (
        f"User transcript: {transcript}\n\n"
        "Tool descriptions:\n"
        + "\n".join(f"- {k}: {v}" for k, v in _TOOL_DESCRIPTIONS.items())
    )
    try:
        plan = await llm.complete_json(
            [Message(role="user", content=planner_user)],
            system=planner_system,
            max_tokens=260,
            user_id=user.id,
            agent="orb_planner",
        )
    except Exception as exc:  # noqa: BLE001
        log.debug("orb planner fallback to ask_briefly: %s", exc)
        return None

    raw_steps = plan.get("steps") if isinstance(plan, dict) else None
    if not isinstance(raw_steps, list) or not raw_steps:
        return None

    steps: list[str] = []
    for step in raw_steps[:_MAX_TOOL_STEPS]:
        if not isinstance(step, dict):
            continue
        tool = str(step.get("tool") or "").strip()
        if tool in _TOOL_DESCRIPTIONS:
            steps.append(tool)
    if not steps:
        return None

    tool_outputs: list[dict] = []
    resolved_thread_id = thread_id
    for tool_name in steps:
        out = await _run_tool_by_name(
            tool_name,
            db=db,
            user=user,
            transcript=transcript,
            thread_id=resolved_thread_id,
            content_id=content_id,
        )
        if out.get("thread_id"):
            resolved_thread_id = out["thread_id"]
        tool_outputs.append({"tool": tool_name, **out})

    # Single tool can return directly; multi-tool gets synthesized.
    if len(tool_outputs) == 1:
        only = tool_outputs[0]
        return {
            "thread_id": only.get("thread_id") or resolved_thread_id,
            "answer": only.get("answer", ""),
            "citations": only.get("citations", []),
            "tool_trace": _tool_trace(tool_outputs),
        }

    synthesis_system = (
        "You are Briefly Orb. Synthesize multiple tool outputs into one concise spoken answer.\n"
        "Return strict JSON: {\"answer\":\"...\"}. Keep it practical and direct."
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
        "thread_id": resolved_thread_id,
        "answer": final_answer,
        "citations": _merge_citations(tool_outputs),
        "tool_trace": _tool_trace(tool_outputs),
    }


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
    typed `text`. Returns the transcript plus the grounded answer + citations.
    """
    transcript = (text or "").strip()

    if audio_bytes:
        stt = get_stt_adapter()
        transcript = (
            await stt.transcribe(
                audio_bytes,
                filename=filename,
                content_type=content_type,
            )
        ).strip()

    if not transcript:
        raise ValueError("No speech detected — try again.")

    llm_tool_result = await _llm_plan_and_execute(
        db,
        user,
        transcript,
        thread_id=thread_id,
        content_id=content_id,
    )
    if llm_tool_result is not None:
        return {
            "transcript": transcript,
            "thread_id": llm_tool_result.get("thread_id"),
            "answer": llm_tool_result.get("answer", ""),
            "citations": llm_tool_result.get("citations", []),
            "tool_trace": llm_tool_result.get("tool_trace", []),
        }

    # Fallback shortcut router for simple explicit intents if LLM planning is unavailable.
    tool_result = await _run_orb_tools(db, user.id, transcript) if getattr(user, "id", None) else None
    if tool_result is not None:
        return {
            "transcript": transcript,
            "thread_id": thread_id,
            "answer": tool_result.get("answer", ""),
            "citations": tool_result.get("citations", []),
            "tool_trace": [{"tool": "regex_router_fallback", "matched": True}],
        }

    result = await ask_briefly(
        db,
        user,
        transcript,
        thread_id=thread_id,
        content_id=content_id,
    )
    assistant = result.get("assistant", {}) if isinstance(result, dict) else {}

    return {
        "transcript": transcript,
        "thread_id": result.get("thread_id") if isinstance(result, dict) else None,
        "answer": assistant.get("content", ""),
        "citations": assistant.get("citations", []),
        "tool_trace": [{"tool": "ask_briefly_fallback"}],
    }
