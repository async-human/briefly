from datetime import datetime, timezone
from types import SimpleNamespace

from briefly_api.services.decisions.retrieval import (
    format_decision_timeline,
    is_decision_query,
    thread_relevance,
)


def test_decision_intent_is_detected():
    assert is_decision_query("What did we decide about enterprise pricing?")
    assert not is_decision_query("Summarize today's articles")


def test_relevant_thread_beats_unrelated_thread():
    relevant = thread_relevance(
        "Should we hold premium API pricing?",
        title="Premium API pricing",
        question="Can we hold premium API pricing?",
        belief="Enterprise customers will pay for reliability.",
        status="open",
    )
    unrelated = thread_relevance(
        "Should we hold premium API pricing?",
        title="European hiring",
        question="Should we hire in Europe?",
        belief="The talent pool is strong.",
        status="open",
    )
    assert relevant > unrelated


def test_timeline_format_distinguishes_evidence_from_founder_outcome():
    thread = SimpleNamespace(
        question="Can we hold premium pricing?",
        current_belief="Reliability supports a premium.",
        status="open",
        confidence=0.67,
    )
    now = datetime.now(timezone.utc)
    text = format_decision_timeline(thread, [
        {"at": now, "type": "signal", "stance": "contradicting", "headline": "Competitor cut price"},
        {"at": now, "type": "outcome", "outcome": "confirmed", "note": "Hold position"},
    ])
    assert "evidence (contradicting)" in text
    assert "founder outcome: confirmed" in text
