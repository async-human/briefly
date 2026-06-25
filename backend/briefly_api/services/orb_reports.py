"""Long-form report composition for voice orb workflows."""
from __future__ import annotations

import json
import logging
import re

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import User
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.ask_briefly import ask_briefly
from briefly_api.services.web_search import web_search

log = logging.getLogger(__name__)


def extract_report_goal(transcript: str, args: dict | None) -> str:
    if args and args.get("topic"):
        return str(args["topic"]).strip()
    if args and args.get("goal"):
        return str(args["goal"]).strip()
    text = (transcript or "").strip()
    for pat in (
        r"\b(?:write|compose|create|draft|prepare|make|generate)\s+(?:a\s+|my\s+|the\s+)?"
        r"(?:detailed\s+)?(?:report|summary|write-up)\s+(?:on|about|for)\s+(.+?)(?:\s+and\s+|\?|$)",
        r"\breport\s+(?:on|about|for)\s+(.+?)(?:\?|$)",
        r"\bresearch\s+(?:on|about|for)\s+(.+?)\s+and\s+(?:write|create|compose|draft)(?:\s+me)?\s+(?:a\s+)?(?:report|summary)",
    ):
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1).strip().rstrip(".")
    cleaned = re.sub(
        r"^(?:please\s+)?(?:write|compose|create|draft|make|generate)\s+(?:a\s+|my\s+|the\s+)?"
        r"(?:detailed\s+)?(?:report|summary|write-up)\s+(?:on|about|for)\s+",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    return cleaned or text


def _spoken_excerpt(body: str, *, max_chars: int = 1200) -> str:
    text = (body or "").strip()
    if len(text) <= max_chars:
        return text
    cut = text[: max_chars - 1].rsplit(" ", 1)[0]
    return cut + "…"


async def compose_report(
    db: AsyncSession,
    user: User,
    goal: str,
    *,
    thread_id: str | None = None,
) -> dict:
    """Research + user corpus + synthesis into a spoken-friendly report."""
    goal = (goal or "").strip()
    if not goal:
        return {"answer": "What topic should the report cover?", "citations": [], "expects_reply": True}

    web_hits = await web_search(goal)
    web_lines = [
        f"- {r.get('title', 'Result')}: {(r.get('snippet') or '')[:200]}"
        for r in web_hits[:5]
    ]
    web_block = "\n".join(web_lines) if web_lines else "(no web results — corpus only)"

    corpus_block = ""
    citations: list[dict] = []
    try:
        ask = await ask_briefly(db, user, goal, thread_id=thread_id, voice=True)
        assistant = (ask or {}).get("assistant") or {}
        corpus_block = str(assistant.get("content") or "").strip()
        citations = list(assistant.get("citations") or [])
        if ask.get("thread_id"):
            thread_id = ask["thread_id"]
    except Exception:
        log.debug("compose_report ask_briefly failed", exc_info=True)

    llm = get_llm_adapter()
    prompt = (
        f"Topic: {goal}\n\n"
        f"From the user's own sources:\n{corpus_block or '(none)'}\n\n"
        f"From the open web:\n{web_block}\n\n"
        "Write a detailed but speakable report (4-8 short paragraphs). "
        "Lead with the headline takeaway, then supporting points. "
        "No markdown headings — plain spoken prose."
    )
    try:
        resp = await llm.complete(
            [Message(role="user", content=prompt)],
            system="You write executive briefings for a voice assistant.",
            max_tokens=900,
            user_id=user.id,
            agent="orb_report",
        )
        body = (resp.content or "").strip()
    except Exception:
        log.exception("compose_report LLM failed")
        body = corpus_block or "I couldn't finish the report — try again in a moment."

    if not body:
        body = "I couldn't assemble a report from your sources right now."

    spoken = _spoken_excerpt(body)
    return {
        "answer": f"I've finished your report on {goal}. {spoken}",
        "report_body": body,
        "report_topic": goal,
        "citations": citations,
        "thread_id": thread_id,
        "display": f"Report ready — {goal[:60]}\nSay “email this report” or “tell me more”.",
    }
