"""Tests for score breakdown explanations."""
from __future__ import annotations

from briefly_api.services.score_explain import build_score_breakdown, why_this_summary


def test_build_score_breakdown_top_dimension():
    breakdown = build_score_breakdown(
        semantic=0.5,
        topic=0.9,
        quality=0.6,
        recency=0.7,
        source=0.4,
    )
    assert breakdown["top_dimension"] == "topic"
    assert breakdown["contributions"]["topic"] > breakdown["contributions"]["source"]


def test_why_this_summary_source():
    breakdown = build_score_breakdown(
        semantic=0.1,
        topic=0.1,
        quality=0.1,
        recency=0.1,
        source=1.0,
    )
    text = why_this_summary(breakdown, source_name="Stratechery")
    assert text
    assert "Stratechery" in text
