"""Tests for orb tool handlers and routing."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from briefly_api.services import orb_tools
from briefly_api.services.orb_router import regex_matches
from briefly_api.services.weather import extract_weather_location


def test_regex_routes_datetime():
    matched = regex_matches("what day is it today")
    names = {t.name for t in matched}
    assert "current_datetime" in names


def test_regex_routes_weather():
    matched = regex_matches("what's the weather in Mumbai")
    names = {t.name for t in matched}
    assert "weather" in names


def test_extract_weather_location_from_transcript():
    loc = extract_weather_location("what's the weather in London?", None, {})
    assert loc == "London"


@pytest.mark.asyncio
async def test_current_datetime_handler():
    user = SimpleNamespace(
        id="u1",
        profile=SimpleNamespace(digest_timezone="Asia/Kolkata"),
    )
    out = await orb_tools.current_datetime_handler(None, user)
    assert "It's" in out["answer"]
    assert out["citations"] == []


@pytest.mark.asyncio
async def test_user_preferences_handler_empty_profile():
    user = SimpleNamespace(id="u1", profile=None)
    out = await orb_tools.user_preferences_handler(None, user)
    assert "profile" in out["answer"].lower()


@pytest.mark.asyncio
async def test_user_preferences_handler_with_interests():
    user = SimpleNamespace(
        id="u1",
        profile=SimpleNamespace(
            role="founder",
            interests=[{"topic": "AI agents", "weight": 0.9}],
            topic_clusters=[{"cluster": "agentic AI"}],
            never_show=[],
        ),
    )
    out = await orb_tools.user_preferences_handler(None, user)
    assert "AI agents" in out["answer"]
    assert "founder" in out["answer"]
