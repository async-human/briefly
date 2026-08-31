"""Decision Threads — titles, stance, confidence, and matching."""
from __future__ import annotations

from briefly_api.services.decisions.threads import (
    confidence_from_counts,
    digest_fields,
    format_threads_for_prompt,
    stance_for_signal,
    thread_matches_text,
    title_from_question,
)
from briefly_api.services.operating_context import distinctive_tokens


def test_title_from_question_strips_lead_and_time_words():
    assert title_from_question("Should we change model providers this quarter?") == "change model providers"
    assert title_from_question("Can we stay on Claude?") == "stay on Claude"
    assert title_from_question("Model economics") == "Model economics"


def test_stance_contradicts_on_state_change_or_flag():
    assert stance_for_signal(previous_state="held", new_state="cut 40%") == "contradicting"
    assert stance_for_signal(is_contradictory=True) == "contradicting"
    assert stance_for_signal(previous_state="", new_state="cut 40%") == "supporting"
    assert stance_for_signal(previous_state="cut 40%", new_state="cut 40%") == "supporting"


def test_confidence_is_none_until_evidence_exists():
    assert confidence_from_counts(0, 0) is None
    assert confidence_from_counts(1, 0) == 0.67
    assert confidence_from_counts(1, 1) == 0.5
    assert confidence_from_counts(0, 1) == 0.33
    assert confidence_from_counts(-1, 0) is None


def test_thread_matches_distinctive_tokens():
    q = "Should we change model providers this quarter?"
    assert distinctive_tokens(q) == ["change", "model", "providers", "quarter"]
    assert thread_matches_text(q, "Anthropic cut API prices for their model providers")
    assert not thread_matches_text(q, "City council debates parking")
    assert not thread_matches_text(q, "")


def test_digest_fields_empty_without_snapshot():
    assert digest_fields(None) == {}
    fields = digest_fields({
        "thread_id": "t1",
        "title": "model providers",
        "belief": "Stay on Claude",
        "confidence": 0.5,
        "previous_confidence": 0.67,
        "status": "reconsider",
        "stance": "contradicting",
    })
    assert fields["decision_thread_id"] == "t1"
    assert fields["decision_stance"] == "contradicting"
    assert fields["decision_previous_confidence"] == 0.67


def test_format_threads_omits_invented_percent():
    class Fake:
        title = "model providers"
        question = "Should we change model providers?"
        current_belief = "Stay on Claude"
        confidence = None
        previous_confidence = None
        status = "open"

    text = format_threads_for_prompt([Fake()])  # type: ignore[arg-type]
    assert "unscored" in text
    assert "Stay on Claude" in text
    assert "%" not in text.replace("unscored", "")
