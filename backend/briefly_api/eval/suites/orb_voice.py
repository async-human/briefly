"""
briefly_api/eval/suites/orb_voice.py

Eval suite for the voice orb — routing via regex fast-path (deterministic).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from briefly_api.eval.harness import EvalCase, ScoreResult
from briefly_api.eval.scorers import NonEmpty
from briefly_api.services.orb_router import regex_matches, route_transcript

SUITE = "orb_voice"
MIN_PASS_RATE = 0.75


CASES: list[EvalCase] = [
    EvalCase(
        id="route_today_brief",
        category="routing",
        inputs={"transcript": "What's on my briefing today?"},
        reference={"tools": ["today_brief"]},
    ),
    EvalCase(
        id="route_calendar",
        category="routing",
        inputs={"transcript": "What's on my calendar tomorrow?"},
        reference={"tools": ["calendar_upcoming"]},
    ),
    EvalCase(
        id="route_capture",
        category="routing",
        inputs={"transcript": "Remember this — we should follow up with Sarah on pricing."},
        reference={"tools": ["capture_thought"]},
    ),
    EvalCase(
        id="route_confirm_send",
        category="routing",
        inputs={"transcript": "Yes, send it now"},
        reference={"tools": ["confirm_send"]},
    ),
]


async def _runner(case: EvalCase) -> dict[str, Any]:
    transcript = str(case.inputs.get("transcript") or "")
    matched = regex_matches(transcript)
    decision = await route_transcript(transcript)
    tool_names = [t.name for t in matched]
    if not tool_names and decision.tools:
        tool_names = [t.name for t in decision.tools]
    return {
        "matched_tools": tool_names,
        "route_kind": decision.kind,
        "route_reason": decision.reason,
    }


@dataclass
class RouteToolMatch:
    name: str = "route_tool_match"

    async def score(self, case: EvalCase, output: dict[str, Any]) -> ScoreResult:
        expected = case.reference.get("tools") if case.reference else None
        if not expected:
            return ScoreResult(self.name, 1.0, True, "no expected tools")
        got = output.get("matched_tools") or []
        passed = any(t in got for t in expected)
        return ScoreResult(
            self.name,
            1.0 if passed else 0.0,
            passed,
            f"expected one of {expected}, got {got}",
        )


def build():
    scorers = [
        NonEmpty(field="matched_tools"),
        NonEmpty(field="route_kind"),
        RouteToolMatch(),
    ]
    return SUITE, CASES, _runner, scorers, MIN_PASS_RATE
