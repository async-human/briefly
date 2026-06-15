"""Tests for per-source × per-topic relevance weighting."""
from __future__ import annotations

from types import SimpleNamespace

from briefly_api.agents.context import RawItem
from briefly_api.agents.relevance import _source_topic_weight


def _item(title: str, source_name: str = "HackerNews", summary: str = "") -> RawItem:
    return RawItem(
        id="1",
        source_id="s1",
        source_type="rss",
        source_name=source_name,
        title=title,
        url="https://example.com/a",
        author=None,
        published_at=None,
        clean_text="",
        content_hash="abc",
        summary=summary,
    )


def _ctx(source_topic_weights: dict) -> SimpleNamespace:
    user = SimpleNamespace(profile={"source_topic_weights": source_topic_weights})
    return SimpleNamespace(user=user)


def test_topic_match_returns_learned_weight():
    weights = {"hackernews::infrastructure": {"weight": 0.9, "pos": 8, "neg": 1}}
    ctx = _ctx(weights)
    item = _item("New infrastructure scaling patterns")
    assert _source_topic_weight(item, ctx) == 0.9


def test_no_topic_match_returns_none():
    weights = {"hackernews::infrastructure": {"weight": 0.9, "pos": 8, "neg": 1}}
    ctx = _ctx(weights)
    item = _item("Celebrity design trends")
    assert _source_topic_weight(item, ctx) is None


def test_prefers_topic_with_more_signal():
    weights = {
        "hackernews::design": {"weight": 0.3, "pos": 1, "neg": 1},
        "hackernews::infrastructure": {"weight": 0.95, "pos": 20, "neg": 0},
    }
    ctx = _ctx(weights)
    item = _item("design and infrastructure deep dive")
    # Both topics appear; the one with more accumulated signal wins.
    assert _source_topic_weight(item, ctx) == 0.95


def test_empty_table_returns_none():
    assert _source_topic_weight(_item("anything"), _ctx({})) is None


def test_other_source_weights_ignored():
    weights = {"othersite::infrastructure": {"weight": 0.9, "pos": 5, "neg": 0}}
    ctx = _ctx(weights)
    item = _item("infrastructure news", source_name="HackerNews")
    assert _source_topic_weight(item, ctx) is None
