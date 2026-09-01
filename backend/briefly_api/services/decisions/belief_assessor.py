"""BeliefAssessor — compare a market signal to a stated decision-thread belief.

Directional stances (supporting/contradicting) are only returned when the
assessor is confident the evidence bears on the belief — not merely that
something changed in the world.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.decisions.threads import stance_for_signal

log = logging.getLogger(__name__)

STANCE_THRESHOLD = 0.65
_VALID_STANCES = frozenset({"supporting", "contradicting", "unrelated", "insufficient_evidence"})
_DIRECTIONAL = frozenset({"supporting", "contradicting"})

_SYSTEM = (
    "You compare a founder's stated belief to a detected market change.\n"
    "Return STRICT JSON only:\n"
    '{"stance":"supporting|contradicting|unrelated|insufficient_evidence",'
    '"rationale":"1-2 sentences explaining why this bears on the belief",'
    '"confidence":0.0-1.0,"evidence_index":0}\n\n'
    "Rules:\n"
    "- supporting: the change strengthens or validates the belief\n"
    "- contradicting: the change weakens or challenges the belief\n"
    "- unrelated: topical overlap but no logical bearing on the belief\n"
    "- insufficient_evidence: cannot judge without inventing facts\n"
    "- A competitor price cut alone does NOT contradict 'stay bootstrapped'\n"
    "- Compare belief semantics, not just keywords\n"
    "- rationale must reference the belief and the change\n"
    "- evidence_index is the 0-based index of the cited evidence passage, or -1"
)


@dataclass(frozen=True)
class AssessmentResult:
    stance: str
    rationale: str
    assessor_confidence: float
    evidence_urls: list[str]
    verifier: str = "llm"


def parse_assessment_payload(raw: dict[str, Any], evidence_urls: list[str]) -> AssessmentResult | None:
    stance = str(raw.get("stance") or "").strip().lower()
    if stance not in _VALID_STANCES:
        return None
    rationale = str(raw.get("rationale") or "").strip()[:800]
    try:
        confidence = float(raw.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))
    cited: list[str] = []
    try:
        idx = int(raw.get("evidence_index", -1))
    except (TypeError, ValueError):
        idx = -1
    if 0 <= idx < len(evidence_urls):
        cited = [evidence_urls[idx]]
    return AssessmentResult(
        stance=stance,
        rationale=rationale,
        assessor_confidence=confidence,
        evidence_urls=cited,
        verifier="llm",
    )


def should_apply_directional(result: AssessmentResult) -> bool:
    return (
        result.stance in _DIRECTIONAL
        and result.assessor_confidence >= STANCE_THRESHOLD
        and bool(result.rationale.strip())
    )


def directional_stance(result: AssessmentResult) -> str | None:
    """Map assessment to thread_signal stance when threshold passes."""
    if not should_apply_directional(result):
        return None
    return stance_for_signal(explicit_stance=result.stance)


async def assess_belief(
    *,
    question: str,
    belief: str,
    signal_title: str,
    previous_state: str,
    new_state: str,
    what_changed: str,
    evidence: list[dict[str, str]],
) -> AssessmentResult | None:
    belief = (belief or "").strip()
    if len(belief) < 8:
        return None

    passages = [
        e.get("supporting_passage") or e.get("extracted_claim") or ""
        for e in evidence
    ]
    evidence_urls = [e.get("source_url") or "" for e in evidence if e.get("source_url")]
    evidence_block = "\n".join(
        f"[{i}] {p.strip()[:400]}" for i, p in enumerate(passages) if p.strip()
    ) or "(no passages)"

    prompt = (
        f"Question: {question.strip()[:400]}\n"
        f"Stated belief: {belief[:600]}\n\n"
        f"Signal: {signal_title.strip()[:300]}\n"
        f"Previous state: {(previous_state or 'unknown')[:200]}\n"
        f"New state: {(new_state or 'unknown')[:200]}\n"
        f"What changed: {(what_changed or signal_title)[:400]}\n\n"
        f"Evidence passages:\n{evidence_block}"
    )

    try:
        llm = get_llm_adapter()
        raw = await llm.complete_json(
            messages=[Message(role="user", content=prompt)],
            system=_SYSTEM,
            model="gpt-4o-mini",
            max_tokens=280,
            temperature=0.1,
            agent="belief_assessor",
        )
        if not isinstance(raw, dict):
            return None
        return parse_assessment_payload(raw, evidence_urls)
    except Exception:
        log.debug("BeliefAssessor LLM call failed", exc_info=True)
        return None


async def assess_and_store(
    session,
    *,
    thread: Any,
    signal_id: str,
) -> AssessmentResult | None:
    """Load signal + evidence, assess belief, persist row. Idempotent per thread/signal."""
    from sqlalchemy import select
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from briefly_api.db.models import BeliefAssessment, MarketSignal, SignalEvidence

    belief = (thread.current_belief or "").strip()
    if len(belief) < 8:
        return None

    signal = (
        await session.execute(select(MarketSignal).where(MarketSignal.id == signal_id))
    ).scalar_one_or_none()
    if not signal:
        return None

    evidence_rows = (
        await session.execute(
            select(SignalEvidence).where(SignalEvidence.signal_id == signal_id)
        )
    ).scalars().all()
    evidence = [
        {
            "source_url": row.source_url,
            "supporting_passage": row.supporting_passage,
            "extracted_claim": row.extracted_claim,
        }
        for row in evidence_rows
    ]

    result = await assess_belief(
        question=thread.question,
        belief=belief,
        signal_title=signal.title,
        previous_state=signal.previous_state,
        new_state=signal.new_state,
        what_changed=signal.what_changed,
        evidence=evidence,
    )
    if not result:
        return None

    stmt = (
        pg_insert(BeliefAssessment)
        .values(
            id=str(uuid.uuid4()),
            thread_id=thread.id,
            signal_id=signal_id,
            stance=result.stance,
            rationale=result.rationale,
            assessor_confidence=result.assessor_confidence,
            verifier=result.verifier,
            evidence_urls=result.evidence_urls,
        )
        .on_conflict_do_update(
            index_elements=["thread_id", "signal_id"],
            set_={
                "stance": result.stance,
                "rationale": result.rationale,
                "assessor_confidence": result.assessor_confidence,
                "verifier": result.verifier,
                "evidence_urls": result.evidence_urls,
            },
        )
    )
    await session.execute(stmt)
    return result
