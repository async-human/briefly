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


def _report_headline(body: str, *, max_chars: int = 320) -> str:
    """Short spoken teaser — not the full report."""
    text = (body or "").strip()
    if not text:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", text)
    headline = parts[0].strip() if parts else text
    if len(parts) >= 2 and len(headline) < 80:
        headline = f"{headline} {parts[1].strip()}".strip()
    if len(headline) <= max_chars:
        return headline
    return _spoken_excerpt(headline, max_chars=max_chars)


def build_report_ready_answer(goal: str, body: str) -> str:
    """Offer delivery choice instead of reading the entire report unprompted."""
    headline = _report_headline(body)
    lead = f"I've finished your report on {goal}."
    if headline:
        lead += f" In short: {headline}"
    return (
        f"{lead} "
        "Would you like me to read the full report aloud, draft an email with it, "
        "or are you good for now?"
    )


def build_narrated_report_answer(topic: str, body: str) -> str:
    topic = (topic or "your topic").strip()
    body = (body or "").strip()
    if not body:
        return "I couldn't find the report text — want me to write it again?"
    return f"Alright — here's your full report on {topic}. {body}"


def narrate_cached_report(user_id: str) -> dict:
    from briefly_api.services.orb_report_cache import get_report

    cached = get_report(user_id)
    if not cached or not (cached.get("body") or "").strip():
        return {
            "answer": "I don't have a report ready yet. What topic should I research?",
            "citations": [],
            "expects_reply": True,
        }
    topic = str(cached.get("topic") or "your topic")
    body = str(cached.get("body") or "")
    return {
        "answer": build_narrated_report_answer(topic, body),
        "report_topic": topic,
        "report_body": body,
        "narrate_mode": True,
        "expects_reply": True,
        "display": f"Reading report — {topic[:60]}",
    }


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

    return {
        "answer": build_report_ready_answer(goal, body),
        "report_body": body,
        "report_topic": goal,
        "citations": citations,
        "thread_id": thread_id,
        "display": (
            f"Report ready — {goal[:60]}\n"
            "Say “read it aloud”, “email this report”, or “I'm good”."
        ),
    }
