"""Belief assessor — parsing and threshold logic."""
from __future__ import annotations

from briefly_api.services.decisions.belief_assessor import (
    AssessmentResult,
    directional_stance,
    parse_assessment_payload,
    should_apply_directional,
)


def test_parse_valid_assessment():
    result = parse_assessment_payload(
        {
            "stance": "contradicting",
            "rationale": "Lower API prices weaken the assumption that costs stay stable.",
            "confidence": 0.82,
            "evidence_index": 0,
        },
        ["https://example.com/pricing"],
    )
    assert result is not None
    assert result.stance == "contradicting"
    assert result.evidence_urls == ["https://example.com/pricing"]
    assert should_apply_directional(result) is True
    assert directional_stance(result) == "contradicting"


def test_low_confidence_stays_related():
    result = parse_assessment_payload(
        {
            "stance": "contradicting",
            "rationale": "Maybe relevant",
            "confidence": 0.4,
            "evidence_index": -1,
        },
        [],
    )
    assert result is not None
    assert should_apply_directional(result) is False
    assert directional_stance(result) is None


def test_unrelated_never_directional():
    result = parse_assessment_payload(
        {
            "stance": "unrelated",
            "rationale": "Different topic",
            "confidence": 0.95,
            "evidence_index": -1,
        },
        [],
    )
    assert result is not None
    assert should_apply_directional(result) is False


def test_invalid_stance_rejected():
    assert parse_assessment_payload({"stance": "maybe", "confidence": 0.9}, []) is None
