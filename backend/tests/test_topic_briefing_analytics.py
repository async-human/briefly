"""Tests for per-topic briefing analytics."""
from __future__ import annotations

from types import SimpleNamespace

from briefly_api.db.models import SignalType
from briefly_api.services.topic_briefing_analytics import (
    aggregate_topic_stats,
    build_topic_actual,
    build_tracked_topics,
)


def _item(
    item_id: str,
    headline: str,
    *,
    summary: str = "",
    source: str = "Hacker News",
    confidence_signal: str | None = None,
    digest_date: str = "2026-06-01",
):
    return SimpleNamespace(
        id=item_id,
        headline=headline,
        summary=summary,
        source_name=source,
        confidence_signal=confidence_signal,
        digest_date=digest_date,
    )


def _signal(item_id: str, signal_type: SignalType):
    return SimpleNamespace(
        digest_item_id=item_id,
        signal_type=signal_type,
        created_at=None,
        headline=None,
        source_name=None,
        summary=None,
    )


def test_build_tracked_topics_from_interests():
    profile = SimpleNamespace(
        interests=[{"topic": "startup funding"}, {"topic": "generative ai"}],
        topic_clusters=[],
    )
    topics = build_tracked_topics(profile)
    assert "startup funding" in topics
    assert topics["startup funding"]["source"] == "declared"


def test_aggregate_counts_matching_stories_and_signals():
    profile = SimpleNamespace(
        interests=[{"topic": "startup funding"}, {"topic": "generative ai"}],
        topic_clusters=[],
    )
    tracked = build_tracked_topics(profile)
    rows = [
        _item(
            "1",
            "BazaarNow secures Rs 72 Cr funding round for quick commerce",
            digest_date="2026-06-01",
        ),
        _item(
            "2",
            "Inside Cube: the generative AI semantic layer for agents",
            digest_date="2026-06-02",
        ),
        _item("3", "Congress passes a new spending bill", digest_date="2026-06-03"),
    ]
    signals = [
        _signal("1", SignalType.saved),
        _signal("2", SignalType.skipped),
    ]

    stats = aggregate_topic_stats(tracked, rows, signals)

    assert stats["startup funding"].stories_shown == 1
    assert stats["startup funding"].saves == 1
    assert stats["generative ai"].stories_shown == 1
    assert stats["generative ai"].skipped == 1
    assert stats["generative ai"].briefing_days == 1


def test_build_topic_actual_includes_declared_with_zero_counts():
    profile = SimpleNamespace(
        interests=[{"topic": "startup funding"}, {"topic": "langchain"}],
        topic_clusters=[],
    )
    tracked = build_tracked_topics(profile)
    rows = [
        _item("1", "BazaarNow secures Rs 72 Cr in startup funding"),
    ]
    stats = aggregate_topic_stats(tracked, rows, [])
    analytics = SimpleNamespace(
        tracked_topics=tracked,
        topic_stats=stats,
    )

    actual = build_topic_actual(analytics)

    assert actual["startup funding"]["stories_shown"] == 1
    assert actual["langchain"]["stories_shown"] == 0
    assert actual["langchain"]["ready"] is False


def test_bill_of_materials_does_not_false_match():
    profile = SimpleNamespace(
        interests=[{"topic": "bill of materials"}],
        topic_clusters=[],
    )
    tracked = build_tracked_topics(profile)
    rows = [_item("1", "Congress passes a new spending bill")]
    stats = aggregate_topic_stats(tracked, rows, [])
    assert stats["bill of materials"].stories_shown == 0
