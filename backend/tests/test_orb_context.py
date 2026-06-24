"""Tests for orb context engineering (tool slots + conversation memory)."""
from __future__ import annotations

import asyncio

from briefly_api.services.orb_context import (
    OrbToolContext,
    resolve_weather_location,
    update_tool_slots_from_turn,
)
from briefly_api.services.orb_intent import classify_orb_intent
from briefly_api.services.orb_session import OrbSessionState


def test_resolve_weather_from_session_slot():
    ctx = OrbToolContext(tool_slots={"weather": {"location": "Pune"}})
    loc = resolve_weather_location("any chance of rain?", None, ctx)
    assert loc == "Pune"


def test_resolve_weather_from_thread_history():
    ctx = OrbToolContext(
        thread_messages=[
            {"role": "user", "content": "What's the weather in Pune?"},
            {
                "role": "assistant",
                "content": "In Pune, India, it's partly cloudy around 28 degrees Celsius.",
            },
        ]
    )
    loc = resolve_weather_location("any chance of rain?", None, ctx)
    assert loc == "Pune"


def test_resolve_weather_from_last_answer():
    ctx = OrbToolContext(
        last_answer="In Mumbai, it's clear skies around 32 degrees Celsius.",
    )
    loc = resolve_weather_location("will it rain?", None, ctx)
    assert loc == "Mumbai"


def test_update_tool_slots_after_weather_turn():
    state = OrbSessionState(session_id="s1", user_id="u1")
    update_tool_slots_from_turn(
        state,
        "weather",
        "what's the weather in Pune?",
        "In Pune, India, it's partly cloudy.",
    )
    assert state.tool_slots["weather"]["location"] == "Pune"


def test_weather_rain_follow_up_routes_with_affinity():
    session = OrbSessionState(
        session_id="s1",
        user_id="u1",
        last_tool="weather",
        last_transcript="what's the weather in Pune",
        tool_slots={"weather": {"location": "Pune"}},
    )
    decision = asyncio.run(
        classify_orb_intent(
            "any chance of rain?",
            thread_message_count=2,
            session=session,
            session_has_prior_turn=True,
        )
    )
    assert decision.kind == "direct"
    assert decision.tools[0].name == "weather"
    assert decision.reason == "thread_affinity"
