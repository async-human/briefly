"""
briefly_api/agents/skills/contradiction_skill.py

ContradictionSkill — execution wrapper.

The reasoning lives in:
  contradiction/SKILL.md                                    (system prompt)
  contradiction/references/contradiction_detection_rules.md (worked examples)

Only invoked when cosine similarity between items ≥ enrichment_contradiction_min_similarity.
The similarity gate avoids LLM calls for clearly unrelated items.
To improve contradiction detection — edit SKILL.md or reference files.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from briefly_api.agents.skills.skill_loader import get_skill
from briefly_api.llm.adapter import Message, get_llm_adapter

log = logging.getLogger(__name__)

_SKILL = get_skill("contradiction")


@dataclass
class ContradictionResult:
    contradicts: bool = False
    explanation: str | None = None


class ContradictionSkill:
    """
    Detects factual contradictions between a new item and a recent item.

    Args:
        new_title:   Title of the new item
        new_summary: Summary of the new item
        old_title:   Title of the potentially contradicted past item
        old_summary: Summary of the past item

    Returns:
        ContradictionResult dataclass
    """

    async def run(
        self,
        new_title: str,
        new_summary: str,
        old_title: str,
        old_summary: str,
    ) -> ContradictionResult:
        # Include worked examples from the reference file —
        # they dramatically improve precision on edge cases.
        system = (
            _SKILL.body
            + "\n\n"
            + _SKILL.reference("contradiction_detection_rules.md")
        )

        prompt = (
            f"New item:\nTitle: {new_title}\nSummary: {new_summary[:400]}\n\n"
            f"Old item (already shown to user):\nTitle: {old_title}\n"
            f"Summary: {old_summary[:400]}\n\n"
            f"Does the new item directly contradict a specific factual claim in the old item?"
        )

        llm = get_llm_adapter()
        try:
            result = await llm.complete_json(
                messages=[Message(role="user", content=prompt)],
                system=system,
                model=_SKILL.model or "gpt-5-mini",
                max_tokens=_SKILL.max_tokens or 120,
            )
            return ContradictionResult(
                contradicts=bool(result.get("contradicts")),
                explanation=result.get("explanation"),
            )
        except Exception:
            log.debug("ContradictionSkill: LLM call failed", exc_info=True)
            return ContradictionResult()
