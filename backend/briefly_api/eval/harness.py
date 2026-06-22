"""
briefly_api/eval/harness.py

The eval backbone for Briefly's agent + act layers. Reliability is the whole game
for an agent product, so every capability gets a measurable, regressable suite.

Design (provider-agnostic, async):
  - EvalCase     — one test: inputs + optional reference, tagged by category.
  - Runner       — async fn that turns a case into an output dict (the thing under test).
  - Scorer       — async fn that scores (case, output) on one metric → ScoreResult.
  - run_suite    — runs a dataset through a runner + scorers, bounded-concurrency.
  - SuiteReport  — aggregate pass rates per metric + overall, JSON-serializable, with
                   a `gate()` used by CI to fail the build on regressions.

Scorers are pluggable: deterministic checks run offline; LLM-as-judge scorers
(faithfulness, task-success) run when a model is configured.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol


@dataclass
class EvalCase:
    id: str
    category: str
    inputs: dict[str, Any]
    reference: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ScoreResult:
    metric: str
    score: float  # normalized 0.0–1.0
    passed: bool
    detail: str = ""


class Scorer(Protocol):
    name: str

    async def score(self, case: EvalCase, output: dict[str, Any]) -> ScoreResult: ...


# A runner turns a case into the output under test (e.g. an email draft, an agent run).
Runner = Callable[[EvalCase], Awaitable[dict[str, Any]]]


@dataclass
class CaseReport:
    case_id: str
    category: str
    scores: list[ScoreResult] = field(default_factory=list)
    output: dict[str, Any] | None = None
    error: str | None = None

    @property
    def passed(self) -> bool:
        return self.error is None and bool(self.scores) and all(s.passed for s in self.scores)

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "category": self.category,
            "passed": self.passed,
            "error": self.error,
            "scores": [
                {"metric": s.metric, "score": round(s.score, 3), "passed": s.passed, "detail": s.detail}
                for s in self.scores
            ],
        }


@dataclass
class SuiteReport:
    suite: str
    cases: list[CaseReport]
    duration_s: float

    @property
    def pass_rate(self) -> float:
        if not self.cases:
            return 0.0
        return sum(1 for c in self.cases if c.passed) / len(self.cases)

    def metric_averages(self) -> dict[str, float]:
        """Mean score per metric across all cases (the trend line we watch)."""
        sums: dict[str, list[float]] = {}
        for c in self.cases:
            for s in c.scores:
                sums.setdefault(s.metric, []).append(s.score)
        return {m: round(sum(v) / len(v), 3) for m, v in sums.items() if v}

    def summary(self) -> dict[str, Any]:
        return {
            "suite": self.suite,
            "cases": len(self.cases),
            "pass_rate": round(self.pass_rate, 3),
            "metric_averages": self.metric_averages(),
            "duration_s": round(self.duration_s, 2),
            "failures": [c.to_dict() for c in self.cases if not c.passed],
        }

    def gate(self, min_pass_rate: float) -> bool:
        """True if the suite clears the bar — CI fails the build when this is False."""
        return self.pass_rate >= min_pass_rate


async def run_suite(
    suite: str,
    cases: list[EvalCase],
    runner: Runner,
    scorers: list[Scorer],
    *,
    concurrency: int = 4,
) -> SuiteReport:
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _one(case: EvalCase) -> CaseReport:
        async with sem:
            try:
                output = await runner(case)
            except Exception as exc:  # a crash is a failed case, not a crashed suite
                return CaseReport(case.id, case.category, error=repr(exc))
            results: list[ScoreResult] = []
            for scorer in scorers:
                try:
                    results.append(await scorer.score(case, output))
                except Exception as exc:
                    results.append(ScoreResult(scorer.name, 0.0, False, f"scorer error: {exc!r}"))
            return CaseReport(case.id, case.category, results, output)

    started = time.time()
    reports = await asyncio.gather(*[_one(c) for c in cases])
    return SuiteReport(suite, list(reports), time.time() - started)
