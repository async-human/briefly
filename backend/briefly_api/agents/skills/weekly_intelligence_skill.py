"""
briefly_api/agents/skills/weekly_intelligence_skill.py

WeeklyIntelligenceSkill — execution wrapper.

The reasoning lives in:
  weekly_intelligence/SKILL.md                               (system prompt)
  weekly_intelligence/references/mind_shift_detection.md     (shift detection rules)
  weekly_intelligence/references/pattern_analysis_guide.md   (depth scoring + calibration)

This file handles: LLM call, retry, response parsing.
To change what qualifies as a mind shift — edit mind_shift_detection.md.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from briefly_api.agents.skills.skill_loader import get_skill
from briefly_api.llm.adapter import Message, get_llm_adapter

log = logging.getLogger(__name__)

_SKILL = get_skill("weekly_intelligence")

# Include both reference files — the model needs both for this task.
_SYSTEM = (
    _SKILL.body
    + "\n\n---\n\n"
    + _SKILL.reference("mind_shift_detection.md")
    + "\n\n---\n\n"
    + _SKILL.reference("pattern_analysis_guide.md")
)


@dataclass
class WeeklyIntelligenceResult:
    mind_shifts: list[dict] = field(default_factory=list)
    emerging_threads: list[dict] = field(default_factory=list)
    coverage_gaps: list[str] = field(default_factory=list)
    depth_trend: str = "stable"
    current_focus: str = ""
    weekly_synthesis: str = ""


class WeeklyIntelligenceSkill:
    """
    Longitudinal pattern recognition across 7 days of digest history.

    Args:
        profile_summary:    Current user profile text
        digest_week_items:  List of dicts: {date, headline, was_clicked, follow_up_depth}
        signal_summary:     Dict with aggregate signal counts for the week
        declared_interests: List of declared interest topic strings
        story_threads:      Current active story thread keys

    Returns:
        WeeklyIntelligenceResult dataclass
    """

    async def run(
        self,
        profile_summary: str,
        digest_week_items: list[dict],
        signal_summary: dict,
        declared_interests: list[str],
        story_threads: list[str],
    ) -> WeeklyIntelligenceResult:
        if not digest_week_items:
            return WeeklyIntelligenceResult()

        items_text   = json.dumps(digest_week_items[:50], indent=2)
        signals_text = json.dumps(signal_summary, indent=2)

        prompt = (
            f"User profile:\n{profile_summary}\n\n"
            f"Declared interests: {', '.join(declared_interests[:10])}\n\n"
            f"Active story threads: {', '.join(story_threads[:10]) or 'None'}\n\n"
            f"Past 7 days of digest items (title + engagement):\n{items_text}\n\n"
            f"Topic-level engagement signals this week:\n{signals_text}\n\n"
            f"Identify meaningful patterns in this week's reading behavior."
        )

        llm = get_llm_adapter()
        try:
            result = await llm.complete_json(
                messages=[Message(role="user", content=prompt)],
                system=_SYSTEM,
                model=_SKILL.model or "claude-sonnet-4-5",
                max_tokens=_SKILL.max_tokens or 600,
                agent="weekly_intelligence",
            )
            return WeeklyIntelligenceResult(
                mind_shifts=result.get("mind_shifts", []),
                emerging_threads=result.get("emerging_threads", []),
                coverage_gaps=result.get("coverage_gaps", []),
                depth_trend=result.get("depth_trend", "stable"),
                current_focus=result.get("current_focus", ""),
                weekly_synthesis=result.get("weekly_synthesis", ""),
            )
        except Exception:
            log.exception("WeeklyIntelligenceSkill: LLM call failed")
            return WeeklyIntelligenceResult()
