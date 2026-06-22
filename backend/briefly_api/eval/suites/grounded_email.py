"""
briefly_api/eval/suites/grounded_email.py

Eval suite for the grounded-email act layer — Phase 1's first workflow, baselined
in Phase 0. Each case gives an instruction + the context the user has "read"; the
runner composes a draft via the SAME code path production uses
(`compose_from_context`), then we score faithfulness (grounded in context, no
fabrication) and task-success.

The fabrication case deliberately omits a fact the instruction asks for, so a
faithful model must NOT invent it — that's the behavior the moat depends on.
"""
from __future__ import annotations

from typing import Any

from briefly_api.eval.harness import EvalCase, Scorer
from briefly_api.eval.scorers import FaithfulnessJudge, MaxWords, NonEmpty, TaskSuccessJudge
from briefly_api.services.email_drafts import compose_from_context

SUITE = "grounded_email"
MIN_PASS_RATE = 0.75  # CI gate; raise as the workflow hardens

CASES: list[EvalCase] = [
    EvalCase(
        id="team_note_competitor",
        category="grounded_email",
        inputs={
            "name": "Alex",
            "instruction": "Draft a short note to my team about the most important competitor move in my brief.",
            "context": (
                "- Acme launched usage-based pricing, undercutting our per-seat model by ~30%.\n"
                "- A new YC startup, Borealis, shipped an AI onboarding flow customers are praising.\n"
                "- Our own NPS rose 4 points this month."
            ),
        },
    ),
    EvalCase(
        id="intro_grounded",
        category="grounded_email",
        inputs={
            "name": "Alex",
            "instruction": "Draft an intro email to the author of the piece on agent reliability I read.",
            "context": (
                "- Jordan Lee published 'Why agent reliability beats capability', arguing eval harnesses "
                "matter more than model size for production agents."
            ),
        },
    ),
    EvalCase(
        id="no_fabrication",
        category="grounded_email",
        inputs={
            "name": "Alex",
            # Asks for a number that is NOT in context — a faithful draft must not invent one.
            "instruction": "Email an investor our exact current MRR and growth rate from my brief.",
            "context": (
                "- We closed two enterprise pilots this week.\n"
                "- Product velocity is up; we shipped the act layer.\n"
                "(No revenue figures were in the brief.)"
            ),
        },
    ),
]


async def _runner(case: EvalCase) -> dict[str, Any]:
    fields = await compose_from_context(
        case.inputs["instruction"],
        case.inputs["context"],
        case.inputs.get("name", "the user"),
    )
    return fields  # {subject, body, rationale, to_hint}


def _scorers() -> list[Scorer]:
    return [
        NonEmpty(field="body"),
        MaxWords(limit=220, field="body"),
        FaithfulnessJudge(context_field="context", output_field="body"),
        TaskSuccessJudge(instruction_field="instruction", output_field="body"),
    ]


def build():
    """Return (suite_name, cases, runner, scorers, min_pass_rate) for the CLI runner."""
    return SUITE, CASES, _runner, _scorers(), MIN_PASS_RATE
