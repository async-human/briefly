"""
briefly_api/agents/skills/connection_skill.py

ConnectionSkill — execution wrapper.

The reasoning lives in:
  connection/SKILL.md                                (system prompt)
  connection/references/thread_matching_rules.md     (how to match items to threads)
  connection/references/connection_strength_guide.md (calibration examples)

This file handles: LLM call, retry, response parsing, error handling.
To improve connection detection quality — edit SKILL.md or reference files.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from briefly_api.agents.skills.skill_loader import get_skill
from briefly_api.llm.adapter import Message, get_llm_adapter

log = logging.getLogger(__name__)

_SKILL = get_skill("connection")


@dataclass
class ConnectionResult:
    connected: bool = False
    thread_key: str | None = None
    thread_update: str | None = None
    connection_sentence: str | None = None
    connection_strength: float = 0.0


class ConnectionSkill:
    """
    Finds connections between a new item and a user's reading history.

    Args:
        item_title:    Title of the new content item
        item_summary:  Summary of the new content item (up to 400 chars)
        story_threads: List of active story thread dicts from UserMemory
        recent_items:  Last 7–14 days of digest headlines (list of str)

    Returns:
        ConnectionResult dataclass
    """

    async def run(
        self,
        item_title: str,
        item_summary: str,
        story_threads: list[dict],
        recent_items: list[str],
    ) -> ConnectionResult:
        if not story_threads and not recent_items:
            return ConnectionResult()

        # Load both reference files — thread matching and calibration.
        # Including them costs ~300 extra tokens but dramatically improves
        # the precision of connection detection.
        system = (
            _SKILL.body
            + "\n\n"
            + _SKILL.reference("thread_matching_rules.md")
            + "\n\n"
            + _SKILL.reference("connection_strength_guide.md")
        )

        threads_text = "\n".join(
            f"- '{t.get('key', '')}' (seen {t.get('occurrence_count', 1)}x, "
            f"latest: {(t.get('value') or {}).get('latest_headline', '')[:80]})"
            for t in story_threads[:10]
        )
        recent_text = "\n".join(f"- {h}" for h in recent_items[:15])

        prompt = (
            f"New item:\nTitle: {item_title}\nSummary: {item_summary[:400]}\n\n"
            f"Active story threads:\n{threads_text or 'None'}\n\n"
            f"Recent digest headlines (last 14 days):\n{recent_text or 'None'}\n\n"
            f"Find any connection between the new item and the user's reading history."
        )

        llm = get_llm_adapter()
        try:
            result = await llm.complete_json(
                messages=[Message(role="user", content=prompt)],
                system=system,
                model=_SKILL.model or "claude-sonnet-4-5",
                max_tokens=_SKILL.max_tokens or 200,
                agent="connection",
            )
            return ConnectionResult(
                connected=bool(result.get("connected")),
                thread_key=result.get("thread_key"),
                thread_update=result.get("thread_update"),
                connection_sentence=result.get("connection_sentence"),
                connection_strength=float(result.get("connection_strength", 0.0)),
            )
        except Exception:
            log.debug("ConnectionSkill: LLM call failed", exc_info=True)
            return ConnectionResult()
