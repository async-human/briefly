"""
Brief quality evaluation harness — golden profiles + fixture scoring.

Run: python -m briefly_api.eval.brief_quality
"""
from __future__ import annotations

from dataclasses import dataclass

from briefly_api.agents.briefing_writer import _why_is_personalized


@dataclass
class EvalCase:
    name: str
    why_text: str
    profile: dict
    expect_personalized: bool
    min_section_balance: dict[str, int] | None = None


GOLDEN_CASES: list[EvalCase] = [
    EvalCase(
        name="personalized_with_role",
        why_text="As a founder building AI products, this changes your GTM calculus.",
        profile={"role": "founder", "goal": "build AI product", "interests": [{"topic": "AI"}]},
        expect_personalized=True,
    ),
    EvalCase(
        name="generic_rejected",
        why_text="Worth a read from one of your sources today.",
        profile={"role": "engineer", "interests": [{"topic": "AI"}]},
        expect_personalized=False,
    ),
]


def score_personalization(case: EvalCase) -> bool:
    result = _why_is_personalized(case.why_text, case.profile)
    return result == case.expect_personalized


def score_section_balance(sections: dict[str, int]) -> bool:
    """Expect at least one item in What's new and one in Highly relevant when pool allows."""
    whats_new = sections.get("What's new", 0) + sections.get("whats_new", 0)
    relevant = sections.get("Highly relevant to you", 0) + sections.get("highly_relevant", 0)
    return whats_new >= 1 and relevant >= 1


def run_eval() -> dict:
    results = []
    passed = 0
    for case in GOLDEN_CASES:
        ok = score_personalization(case)
        results.append({"case": case.name, "passed": ok})
        if ok:
            passed += 1
    return {
        "total": len(GOLDEN_CASES),
        "passed": passed,
        "results": results,
    }


if __name__ == "__main__":
    import json
    print(json.dumps(run_eval(), indent=2))
