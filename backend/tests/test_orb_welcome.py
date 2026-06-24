"""Tests for orb welcome greeting."""
from __future__ import annotations

from briefly_api.services.orb_welcome import _first_name, _time_greeting


def test_first_name():
    user = type("U", (), {"name": "Harshal Patel"})()
    assert _first_name(user) == "Harshal"


def test_time_greeting():
    assert _time_greeting("UTC") in {"Good morning", "Good afternoon", "Good evening"}
