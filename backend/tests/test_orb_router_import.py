"""Regression: orb_router must import DATA_TOOLS."""
from __future__ import annotations

from briefly_api.services.orb_router import regex_matches


def test_regex_matches_imported():
    matched = regex_matches("what's on my calendar")
    assert isinstance(matched, list)
