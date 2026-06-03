"""
briefly_api/agents/skills/relevance_skill.py

RelevanceSkill — execution wrapper.

The reasoning lives in:
  relevance_scoring/SKILL.md              (system prompt)
  relevance_scoring/references/           (profile anchor rules)

This file handles: LLM call, retry, response parsing, error handling.
To improve how relevance sentences are written — edit SKILL.md, not this file.
"""
from __future__ import annotations

import logging

from briefly_api.agents.skills.skill_loader import get_skill
from briefly_api.llm.adapter import Message, get_llm_adapter

log = logging.getLogger(__name__)

# Load once at import time — lru_cache ensures single disk read per process
_SKILL = get_skill("relevance_scoring")


class RelevanceSkill:
    """
    Explains why one item is relevant to one user.

    Args:
        item_title:      Title of the content item
        item_summary:    Short text (up to 300 chars) of the item
        profile_summary: Pre-built text describing the user's role/goal/interests

    Returns:
        str — a single sentence explaining relevance, or empty string on failure
    """

    async def run(
        self,
        item_title: str,
        item_summary: str,
        profile_summary: str,
    ) -> str:
        llm    = get_llm_adapter()
        system = _SKILL.body

        # Load reference when item content is available — gives the model
        # the anchor priority rules it needs to pick the right profile anchor
        system = system + "\n\n" + _SKILL.reference("profile_anchor_rules.md")

        prompt = (
            f"User profile:\n{profile_summary}\n\n"
            f"Item title: {item_title}\n"
            f"Item summary: {item_summary[:300]}\n\n"
            f"Why is this item relevant to this user?"
        )
        try:
            resp = await llm.complete(
                messages=[Message(role="user", content=prompt)],
                system=system,
                model=_SKILL.model or "claude-haiku-4-5-20251001",
                max_tokens=_SKILL.max_tokens or 80,
                temperature=0.2,
            )
            return resp.content.strip()
        except Exception:
            log.debug("RelevanceSkill: LLM call failed", exc_info=True)
            return ""
