"""
briefly_api/eval/scorers.py

Reusable scorers for the eval harness.

Two families:
  - Deterministic (run offline, no model): NonEmpty, MaxWords, Contains, NotContains.
  - LLM-as-judge (need a configured model): FaithfulnessJudge, TaskSuccessJudge.

Faithfulness is the load-bearing metric for a *grounded* agent: it measures whether
the output stays anchored in the provided context and invents nothing. Task-success
measures whether the output actually satisfied the instruction.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from briefly_api.eval.harness import EvalCase, ScoreResult


def _get(d: dict[str, Any], path: str, default: str = "") -> str:
    cur: Any = d
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            cur = None
        if cur is None:
            return default
    return str(cur)


# ── Deterministic scorers ──────────────────────────────────────────────────────

@dataclass
class NonEmpty:
    field: str = "body"
    name: str = "non_empty"

    async def score(self, case: EvalCase, output: dict[str, Any]) -> ScoreResult:
        ok = bool(_get(output, self.field).strip())
        return ScoreResult(self.name, 1.0 if ok else 0.0, ok, "" if ok else f"{self.field} is empty")


@dataclass
class MaxWords:
    limit: int
    field: str = "body"
    name: str = "max_words"

    async def score(self, case: EvalCase, output: dict[str, Any]) -> ScoreResult:
        n = len(_get(output, self.field).split())
        ok = n <= self.limit
        return ScoreResult(self.name, 1.0 if ok else 0.0, ok, f"{n} words (limit {self.limit})")


@dataclass
class NotContains:
    """Fails if any forbidden phrase appears — e.g. obvious fabrication tells, or
    placeholders like '[insert]'/'as an AI'."""
    needles: tuple[str, ...]
    field: str = "body"
    name: str = "not_contains"

    async def score(self, case: EvalCase, output: dict[str, Any]) -> ScoreResult:
        text = _get(output, self.field).lower()
        hits = [n for n in self.needles if n.lower() in text]
        ok = not hits
        return ScoreResult(self.name, 1.0 if ok else 0.0, ok, "" if ok else f"found {hits}")


# ── LLM-as-judge scorers ───────────────────────────────────────────────────────

_JUDGE_MAX_TOKENS = 400


async def _judge(system: str, user: str) -> dict[str, Any]:
    """Run a cheap JSON judge through the provider-agnostic LLM adapter."""
    from briefly_api.config import get_settings
    from briefly_api.llm.adapter import Message, get_llm_adapter

    s = get_settings()
    llm = get_llm_adapter(s)
    model = getattr(s, "eval_judge_model", "") or None  # optional cheap-model override
    resp = await llm.complete(
        [Message(role="user", content=user)],
        system=system,
        temperature=0.0,
        max_tokens=_JUDGE_MAX_TOKENS,
        json_mode=True,
        model=model,
        agent="eval_judge",
    )
    text = (resp.content or "").strip()
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return {}


@dataclass
class FaithfulnessJudge:
    """Is the output grounded ONLY in the provided context (no fabricated facts)?
    The core metric for a grounded agent."""
    context_field: str           # where to read context from in case.inputs
    output_field: str = "body"
    threshold: float = 0.8
    name: str = "faithfulness"

    async def score(self, case: EvalCase, output: dict[str, Any]) -> ScoreResult:
        context = _get(case.inputs, self.context_field)
        text = _get(output, self.output_field)
        if not text.strip():
            return ScoreResult(self.name, 0.0, False, "empty output")
        verdict = await _judge(
            "You are a strict evaluator of factual grounding. You output JSON only.",
            (
                "Decide whether the DRAFT only uses facts present in CONTEXT and invents "
                "nothing (no fabricated names, numbers, quotes, links, or claims). "
                'Return JSON: {"grounded": <0.0-1.0>, "fabrications": [<short strings>]}.\n\n'
                f"CONTEXT:\n{context}\n\nDRAFT:\n{text}"
            ),
        )
        score = float(verdict.get("grounded", 0.0) or 0.0)
        fabs = verdict.get("fabrications") or []
        ok = score >= self.threshold
        return ScoreResult(self.name, score, ok, "" if ok else f"fabrications: {fabs}")


@dataclass
class TaskSuccessJudge:
    """Did the output accomplish the task? A case may define its own success bar via
    reference['success_criteria'] — important when the *right* behavior is to refuse
    (e.g. don't invent a figure that isn't in context). Falls back to the raw
    instruction when no criteria is given."""
    instruction_field: str
    output_field: str = "body"
    context_field: str = "context"  # so the judge can tell grounded facts from invented ones
    threshold: float = 0.7
    name: str = "task_success"

    async def score(self, case: EvalCase, output: dict[str, Any]) -> ScoreResult:
        instruction = _get(case.inputs, self.instruction_field)
        text = _get(output, self.output_field)
        context = _get(case.inputs, self.context_field)
        context_block = f"\n\nCONTEXT (the only legitimate source of facts):\n{context}" if context else ""
        criteria = (case.reference or {}).get("success_criteria")
        if criteria:
            rubric = (
                "Judge whether the OUTPUT meets the SUCCESS CRITERIA (this defines what "
                "success means for this task; the raw instruction may be impossible to "
                "satisfy faithfully, and refusing to fabricate can itself be success). "
                "A fact is NOT invented if it appears in the CONTEXT below.\n\n"
                f"SUCCESS CRITERIA:\n{criteria}\n\n"
                f"INSTRUCTION (for context):\n{instruction}{context_block}\n\nOUTPUT:\n{text}"
            )
        else:
            rubric = (
                "Given the INSTRUCTION and the OUTPUT, judge whether the output satisfies "
                "the instruction. A fact is NOT invented if it appears in the CONTEXT below.\n\n"
                f"INSTRUCTION:\n{instruction}{context_block}\n\nOUTPUT:\n{text}"
            )
        verdict = await _judge(
            "You are a strict evaluator of whether a task was accomplished. JSON only.",
            rubric + '\n\nReturn JSON: {"success": <0.0-1.0>, "reason": "<short>"}.',
        )
        score = float(verdict.get("success", 0.0) or 0.0)
        ok = score >= self.threshold
        return ScoreResult(self.name, score, ok, str(verdict.get("reason", ""))[:160])
