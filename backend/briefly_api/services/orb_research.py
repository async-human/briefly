"""Background research tasks triggered from the voice orb."""
from __future__ import annotations

import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.engine import SessionLocal
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.orb_tools import web_search_handler


def extract_research_goal(transcript: str, args: dict | None) -> str:
    if args and args.get("goal"):
        return str(args["goal"]).strip()
    text = (transcript or "").strip()
    if not text:
        return ""
    cleaned = re.sub(
        r"^(please\s+)?(research|look into|investigate)\s+",
        "",
        text,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\s+(and|then)\s+(tell me|let me know|speak up|notify me).*$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    return cleaned.strip() or text


async def run_research_task(payload: dict[str, Any]) -> None:
    user_id = str(payload.get("user_id") or "")
    goal = str(payload.get("goal") or "").strip()
    if not user_id or not goal:
        return

    async with SessionLocal() as db:
        from sqlalchemy import select

        from briefly_api.db.models import ProactiveSurfacingEvent, User

        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        if user is None:
            return

        search_out = await web_search_handler(db, user, transcript=goal, args={"query": goal})
        search_text = str(search_out.get("answer") or "")

        llm = get_llm_adapter()
        try:
            synth = await llm.complete(
                [
                    Message(
                        role="user",
                        content=(
                            f"Research goal: {goal}\n\nWeb findings:\n{search_text}\n\n"
                            "Write a concise spoken summary (2-4 sentences) for a voice assistant."
                        ),
                    )
                ],
                system="You synthesize research for spoken delivery. Be direct and practical.",
                max_tokens=280,
                user_id=user.id,
                agent="orb_research",
            )
            script = (synth.content or search_text).strip()
        except Exception:
            script = search_text.strip() or f"I finished researching {goal}, but couldn't summarize it."

        event = ProactiveSurfacingEvent(
            user_id=user.id,
            event_type="research_complete",
            title=f"Research: {goal[:80]}",
            body=script[:2000],
            priority=7,
        )
        db.add(event)
        await db.commit()
