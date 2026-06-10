"""Tests for calendar briefing helpers, blind spots, and wrapped snapshot."""
from types import SimpleNamespace

from briefly_api.services.blind_spots import detect_blind_spots
from briefly_api.services.calendar_briefing import build_meeting_briefing
from briefly_api.services.wrapped_snapshot import build_wrapped_snapshot, should_surface_wrapped


def test_should_surface_wrapped_on_monday():
    assert should_surface_wrapped("2026-06-08") is True  # Monday
    assert should_surface_wrapped("2026-06-09") is False


def test_build_wrapped_snapshot_monday():
    fp = SimpleNamespace(
        mind_shifts=[{"topic": "AI agents", "direction": "rising", "evidence": "3 saves"}],
        current_focus="Building with LLMs",
        high_engagement_topics=[{"topic": "startups", "follow_up_count": 4}],
        coverage_gaps=["crypto"],
        weekly_snapshot={"depth_trend": "deepening", "weekly_synthesis": "You went deep on agents."},
    )
    snap = build_wrapped_snapshot(fp, run_date="2026-06-08")
    assert snap is not None
    assert snap["current_focus"] == "Building with LLMs"
    assert snap["depth_trend"] == "deepening"
    assert len(snap["mind_shifts"]) == 1


def test_detect_blind_spot_consensus_gap():
    items = [
        SimpleNamespace(id="a", title="Agents take over workflows", source_name="TechCrunch"),
        SimpleNamespace(id="b", title="Agent startups raise billions", source_name="The Information"),
        SimpleNamespace(id="c", title="Why agents win now", source_name="Stratechery"),
        SimpleNamespace(id="d", title="Agents are overhyped", source_name="Marginal Revolution"),
    ]
    cache = {
        "a": {"thread_key": "ai agents", "contradiction_flag": False},
        "b": {"thread_key": "ai agents", "contradiction_flag": False},
        "c": {"thread_key": "ai agents", "contradiction_flag": False},
        "d": {
            "thread_key": "ai agents",
            "contradiction_flag": True,
            "contradiction_explanation": "Prior coverage assumed inevitability; this argues adoption is slower.",
        },
    }
    spots = detect_blind_spots(items, ["a", "b", "c"], cache)
    assert len(spots) == 1
    assert spots[0]["type"] == "consensus_gap"
    assert "counter_argument" in spots[0]


def test_build_meeting_briefing_matches_stories():
    events = [{"title": "Sequoia portfolio review", "start_label": "2:00 PM", "attendees": ["Priya"], "description": ""}]
    items = [
        SimpleNamespace(id="x", title="Sequoia backs new AI agent startup", source_name="FT"),
    ]
    briefing = build_meeting_briefing(events, items, ["x"], [{"topic": "vertical AI agents"}])
    assert briefing is not None
    assert briefing["meetings"][0]["relevant_stories"]
