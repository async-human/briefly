"""Tests for relevance scoring failure modes."""
from __future__ import annotations

from briefly_api.agents.context import RawItem
from briefly_api.agents.relevance import _matches_never_show


def _item(title: str) -> RawItem:
    return RawItem(
        id="1",
        source_id="s1",
        source_type="rss",
        source_name="News",
        title=title,
        url="https://example.com/a",
        author=None,
        published_at=None,
        clean_text="body",
        content_hash="abc",
        summary="summary",
    )


def test_never_show_item_is_blocked():
    item = _item("Celebrity gossip: who wore what")
    assert _matches_never_show(item, ["celebrity"]) is True


def test_never_show_does_not_block_unrelated():
    item = _item("OpenAI releases new reasoning model")
    assert _matches_never_show(item, ["celebrity", "sports"]) is False
