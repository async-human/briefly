"""Tests for closing stats helpers."""
from __future__ import annotations

from types import SimpleNamespace

from briefly_api.services.digest_stats import (
    build_closing_stats,
    format_duration_minutes,
    merged_story_count,
)


def test_format_duration_minutes():
    assert format_duration_minutes(40) == "~40m"
    assert format_duration_minutes(100) == "~1h 40m"
    assert format_duration_minutes(120) == "~2h"


def test_merged_story_count():
    items = [
        SimpleNamespace(duplicate_count=1),
        SimpleNamespace(duplicate_count=3),
        SimpleNamespace(duplicate_count=2),
    ]
    assert merged_story_count(items) == 2


def test_build_closing_stats_includes_monthly_saved():
    digest = SimpleNamespace(
        total_items_ingested=312,
        total_items_shown=9,
        sources_included=["a", "b"],
    )
    items = [SimpleNamespace(duplicate_count=2, source_name="TechCrunch")] * 9
    monthly = {
        "time_saved_label": "~6h 40m",
        "time_saved_minutes": 400,
        "avg_read_minutes": 1.5,
    }
    stats = build_closing_stats(digest, items, monthly)
    assert "That's everything that matters today" in stats["closing_line"]
    assert "312" in stats["closing_line"]
    assert "9" in stats["closing_line"]
    assert "est." in stats["closing_line"]
    assert stats["dedup_line"] is not None
    assert "merged" in stats["dedup_line"]
