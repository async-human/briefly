"""Tests for deduplication agent."""
from __future__ import annotations

from briefly_api.agents.context import RawItem
from briefly_api.agents.deduplication import _semantic_dedup


def _item(item_id: str, title: str, embedding: list[float]) -> RawItem:
    return RawItem(
        id=item_id,
        source_id="s1",
        source_type="rss",
        source_name="Feed A",
        title=title,
        url=f"https://example.com/{item_id}",
        author=None,
        published_at=None,
        clean_text=f"Content about {title}",
        content_hash=item_id,
        summary=title,
        embedding=embedding,
    )


def test_semantic_dedup_merges_similar_items():
    base = [1.0, 0.0, 0.0]
    near = [0.99, 0.01, 0.0]
    a = _item("a", "Story A", base)
    b = _item("b", "Story A duplicate", near)

    result = _semantic_dedup([a, b], threshold=0.82)
    assert len(result) == 1
    assert result[0].id == "a"
    assert len(result[0].duplicate_sources) == 1


def test_semantic_dedup_keeps_different_items():
    a = _item("a", "AI news", [1.0, 0.0, 0.0])
    b = _item("b", "Sports scores", [0.0, 1.0, 0.0])

    result = _semantic_dedup([a, b], threshold=0.82)
    assert len(result) == 2
