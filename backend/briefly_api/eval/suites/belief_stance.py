"""Regression gate for belief-to-signal stance accuracy."""
from __future__ import annotations

from briefly_api.eval.harness import EvalCase, ScoreResult
from briefly_api.services.decisions.belief_assessor import assess_belief

SUITE = "belief_stance"
MIN_PASS_RATE = 0.85

CASES = [
    EvalCase("price_support", "directional", {"question": "Should we compete on enterprise value?", "belief": "Enterprise buyers value reliability enough to accept premium pricing.", "title": "Acme raises enterprise price", "previous": "$80", "new": "$120", "change": "Acme raised enterprise pricing after citing reliability demand."}, {"stance": "supporting"}),
    EvalCase("price_contradict", "directional", {"question": "Can we hold premium pricing?", "belief": "Customers will continue accepting premium API prices.", "title": "Competitor cuts API price", "previous": "$10", "new": "$4", "change": "A direct competitor cut equivalent API pricing by 60%."}, {"stance": "contradicting"}),
    EvalCase("unrelated_bootstrap", "guardrail", {"question": "Should we stay bootstrapped?", "belief": "Staying bootstrapped preserves the control we need.", "title": "Competitor cuts API price", "previous": "$10", "new": "$4", "change": "A competitor reduced token prices."}, {"stance": "unrelated"}),
    EvalCase("insufficient", "guardrail", {"question": "Should we expand to Europe?", "belief": "Europe will be our fastest-growing region.", "title": "New model launched", "previous": "v2", "new": "v3", "change": "A vendor launched a new model without regional adoption data."}, {"stance": "insufficient_evidence"}),
    EvalCase("api_support", "directional", {"question": "Should we build on standard APIs?", "belief": "Model APIs are becoming stable enough for our core workflow.", "title": "API reaches stable release", "previous": "beta", "new": "GA", "change": "The API moved from beta to general availability with an SLA."}, {"stance": "supporting"}),
    EvalCase("api_contradict", "directional", {"question": "Can we depend on Vendor X?", "belief": "Vendor X will preserve backward compatibility.", "title": "Vendor X removes endpoint", "previous": "supported", "new": "removed", "change": "Vendor X removed an endpoint with 30 days notice."}, {"stance": "contradicting"}),
    EvalCase("product_unrelated", "guardrail", {"question": "Should we hire a sales leader?", "belief": "Enterprise pipeline now requires dedicated sales leadership.", "title": "Competitor launches mobile app", "previous": "web only", "new": "mobile", "change": "A competitor added an iOS application."}, {"stance": "unrelated"}),
    EvalCase("demand_support", "directional", {"question": "Should we focus on security teams?", "belief": "Security teams urgently need evidence monitoring.", "title": "Security monitoring tier launches", "previous": "general", "new": "security tier", "change": "Two competitors launched dedicated security-team plans after customer demand."}, {"stance": "supporting"}),
]


class ExactStance:
    name = "stance_accuracy"

    async def score(self, case, output):
        actual = output.get("stance")
        expected = case.reference["stance"]
        passed = actual == expected
        return ScoreResult(self.name, 1.0 if passed else 0.0, passed, f"expected={expected}; actual={actual}")


class DirectionalThreshold:
    name = "directional_threshold"

    async def score(self, case, output):
        directional = output.get("stance") in {"supporting", "contradicting"}
        confidence = float(output.get("confidence") or 0)
        passed = not directional or confidence >= 0.65
        return ScoreResult(self.name, 1.0 if passed else 0.0, passed, f"confidence={confidence:.2f}")


async def _runner(case: EvalCase) -> dict:
    i = case.inputs
    evidence_url = f"https://evidence.example/{case.id}"
    result = await assess_belief(
        question=i["question"], belief=i["belief"], signal_title=i["title"],
        previous_state=i["previous"], new_state=i["new"], what_changed=i["change"],
        evidence=[{"source_url": evidence_url, "supporting_passage": i["change"], "extracted_claim": i["change"]}],
    )
    if not result:
        return {"stance": None, "confidence": 0.0, "evidence_urls": []}
    return {"stance": result.stance, "confidence": result.assessor_confidence, "evidence_urls": result.evidence_urls}


def build():
    return SUITE, CASES, _runner, [ExactStance(), DirectionalThreshold()], MIN_PASS_RATE
