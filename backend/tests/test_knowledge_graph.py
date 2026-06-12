"""Tests for knowledge graph assembly helpers."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from briefly_api.services.knowledge_graph import (
    GraphEdge,
    GraphNode,
    KnowledgeGraph,
    _cosine,
    _slug,
    _topic_match_score,
    filter_graph_by_days,
)
from briefly_api.services.topic_matching import topics_for_digest_item


def test_slug_normalizes_labels():
    assert _slug("Agentic AI") == "agentic-ai"


def test_topic_match_score_finds_keywords():
    score = _topic_match_score("Google released a new agentic AI model", "agentic AI")
    assert score >= 0.5


def test_cosine_identical_vectors():
    vec = [1.0, 0.0, 0.0]
    assert _cosine(vec, vec) == 1.0


def test_topics_for_digest_item_matches_multiple_interests():
    topics = topics_for_digest_item(
        "New LLM benchmarks for agentic AI startups",
        "OpenAI and Anthropic released agent tools for developers.",
        "Hacker News",
        "94% match to agentic AI",
        ["agentic AI", "startup funding", "bill of materials"],
    )
    assert "agentic AI" in topics
    assert "startup funding" not in topics


def test_filter_graph_by_days_keeps_connected_anchors():
    recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    old = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
    graph = KnowledgeGraph(
        nodes=[
            GraphNode("topic:ai", "topic", "AI", 10, {}),
            GraphNode("item:1", "item", "Recent", 5, {"occurred_at": recent}),
            GraphNode("item:2", "item", "Old", 5, {"occurred_at": old}),
        ],
        edges=[
            GraphEdge("e1", "item:1", "topic:ai", "belongs_to", 0.8),
            GraphEdge("e2", "item:2", "topic:ai", "belongs_to", 0.8),
        ],
        stats={"edge_count": 2},
    )
    filtered = filter_graph_by_days(graph, 7)
    ids = {n.id for n in filtered.nodes}
    assert "item:1" in ids
    assert "item:2" not in ids
    assert "topic:ai" in ids
    assert filtered.stats["time_window_days"] == 7
