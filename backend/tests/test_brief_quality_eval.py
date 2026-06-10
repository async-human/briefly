"""Tests for the brief quality evaluation harness."""
from __future__ import annotations

from briefly_api.eval.brief_quality import GOLDEN_CASES, run_eval, score_personalization, score_section_balance


def test_golden_personalization_cases():
    for case in GOLDEN_CASES:
        assert score_personalization(case) is True


def test_section_balance_scoring():
    assert score_section_balance({"What's new": 2, "Highly relevant to you": 3})
    assert not score_section_balance({"What's new": 0, "Highly relevant to you": 5})


def test_run_eval_all_pass():
    report = run_eval()
    assert report["passed"] == report["total"]
