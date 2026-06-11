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
        mind_shifts=[{
            "topic": "AI agents",
            "direction": "rising",
            "evidence": "3 saves",
            "examples": [{"headline": "Agents take over", "source": "TechCrunch"}],
        }],
        current_focus="Building with LLMs",
        high_engagement_topics=[{
            "topic": "startups",
            "follow_up_count": 4,
            "recent_pos": 2,
            "click_count": 4,
            "examples": [{"headline": "Startup raises", "source": "FT"}],
        }],
        low_engagement_topics=[],
        coverage_gaps=["crypto"],
        reading_time_pattern={"reads_this_week": 5, "reads_prior_week": 2},
        weekly_snapshot={"depth_trend": "deepening", "weekly_synthesis": "You went deep on agents."},
    )
    snap = build_wrapped_snapshot(fp, run_date="2026-06-08")
    assert snap is not None
    assert snap["synthesis"] == "You went deep on agents."
    assert snap["depth_trend"] == "deepening"
    assert snap["depth_label"] == "Reading deeper than usual"
    assert len(snap["shifts"]) == 1
    assert snap["shifts"][0]["label"] == "Picking up"
    assert snap["active_topics"][0]["topic"] == "startups"
    assert "this week" in snap["active_topics"][0]["detail"]
    assert snap["week_stats"]["delta_label"] == "3 more reads than last week"
    assert snap["uncovered"][0]["topic"] == "crypto"
    assert snap["section_hints"]["ignored"]


def test_build_wrapped_snapshot_excludes_declining_from_active_topics():
    fp = SimpleNamespace(
        mind_shifts=[
            {
                "topic": "newsletters",
                "direction": "declining",
                "evidence": "clicked 3x in last month but 0x in last week",
                "examples": [{"headline": "Lenny's Newsletter", "source": "Lenny"}],
            }
        ],
        current_focus="",
        high_engagement_topics=[
            {
                "topic": "newsletters",
                "follow_up_count": 0,
                "engagement_rate": 1.0,
                "recent_pos": 0,
                "click_count": 3,
            }
        ],
        low_engagement_topics=[],
        coverage_gaps=[],
        reading_time_pattern={},
        weekly_snapshot={},
    )
    snap = build_wrapped_snapshot(fp, run_date="2026-06-08", force=True)
    assert snap is not None
    assert len(snap["shifts"]) == 1
    assert snap["shifts"][0]["label"] == "Cooling off"
    assert snap["shifts"][0]["examples"][0]["headline"] == "Lenny's Newsletter"
    assert snap["active_topics"] == []
    assert snap["high_engagement"] == []
    assert "newsletters" in snap["synthesis"].lower()


def test_build_wrapped_snapshot_splits_ignored_and_uncovered():
    fp = SimpleNamespace(
        mind_shifts=[],
        current_focus="",
        high_engagement_topics=[],
        low_engagement_topics=[
            {
                "topic": "crypto",
                "skip_count": 8,
                "actual_clicks": 1,
                "examples": [{"headline": "Bitcoin hits ATH", "source": "CoinDesk"}],
            }
        ],
        coverage_gaps=["context engineering", "crypto"],
        reading_time_pattern={},
        weekly_snapshot={},
    )
    snap = build_wrapped_snapshot(fp, run_date="2026-06-08", force=True)
    assert snap is not None
    assert len(snap["ignored"]) == 1
    assert snap["ignored"][0]["topic"] == "crypto"
    assert "skipped" in snap["ignored"][0]["detail"]
    assert len(snap["uncovered"]) == 1
    assert snap["uncovered"][0]["topic"] == "context engineering"
    assert snap["uncovered"][0]["action"]["href"] == "/settings"


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
