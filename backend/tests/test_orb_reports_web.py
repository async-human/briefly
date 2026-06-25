"""Tests for report extraction and web search answer formatting."""
from __future__ import annotations

from briefly_api.services.orb_reports import extract_report_goal


def test_extract_report_goal_create_report_on_topic():
    goal = extract_report_goal("create a report on quantum computing", None)
    assert "quantum" in goal.lower()


def test_extract_report_goal_write_report():
    goal = extract_report_goal("write a report about AI safety", None)
    assert "ai safety" in goal.lower()
