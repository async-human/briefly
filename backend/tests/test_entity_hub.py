"""Entity Hub assembly — structured profile, not a link dump."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from briefly_api.services.entity_hub import assemble_hub, relative_when, resolve_hub_node, synthesize_summary
from briefly_api.services.knowledge_graph import GraphEdge, GraphNode, KnowledgeGraph


def _graph() -> KnowledgeGraph:
    now = datetime.now(timezone.utc)
    recent = (now - timedelta(days=0)).isoformat()
    older = (now - timedelta(days=3)).isoformat()
    return KnowledgeGraph(
        nodes=[
            GraphNode(
                "entity:1",
                "entity",
                "Anthropic",
                12,
                {"kind": "company", "watching": True, "watched_id": "1"},
            ),
            GraphNode("topic:ai", "topic", "AI safety", 10, {"strength_pct": 62}),
            GraphNode(
                "item:a",
                "item",
                "Launched Claude 3.5 Sonnet",
                6,
                {
                    "occurred_at": recent,
                    "source_name": "TechCrunch",
                    "memory_reference": "Watch their enterprise pricing closely.",
                },
            ),
            GraphNode(
                "item:b",
                "item",
                "Hired Head of Enterprise Sales",
                5,
                {"occurred_at": older, "source_name": "The Information"},
            ),
            GraphNode("entity:2", "entity", "OpenAI", 11, {"kind": "company", "watching": True}),
        ],
        edges=[
            GraphEdge("e1", "entity:1", "item:a", "mentioned_with", 0.7, "mentioned with"),
            GraphEdge("e2", "entity:1", "item:b", "mentioned_with", 0.6, "mentioned with"),
            GraphEdge("e3", "entity:1", "topic:ai", "watches", 0.5, "watching"),
            GraphEdge("e4", "item:a", "entity:2", "mentioned_with", 0.5, "mentioned with"),
        ],
        stats={},
    )


def test_relative_when_buckets():
    now = datetime(2026, 8, 31, tzinfo=timezone.utc)
    assert relative_when(now.isoformat(), now) == "Today"
    assert relative_when((now - timedelta(days=3)).isoformat(), now) == "3 days ago"
    assert relative_when((now - timedelta(days=10)).isoformat(), now) == "Last week"


def test_resolve_prefers_entity_over_item():
    graph = _graph()
    node = resolve_hub_node(graph, q="Anthropic")
    assert node is not None
    assert node.id == "entity:1"


def test_hub_is_a_profile_not_a_link_list():
    hub = assemble_hub(_graph(), _graph().nodes[0])
    assert hub["name"] == "Anthropic"
    assert hub["kind"] == "company"
    assert hub["watching"] is True
    assert "you're watching" in hub["summary"].lower()
    assert len(hub["timeline"]) == 2
    assert hub["timeline"][0]["title"] == "Launched Claude 3.5 Sonnet"
    assert "OpenAI" in hub["timeline"][0]["linked"]
    labels = [c["label"] for c in hub["connected"]]
    assert "AI safety" in labels
    assert any(m["text"].startswith("Watch their enterprise") for m in hub["memory"])
    assert all("item:" not in c["id"] for c in hub["connected"])


def test_topic_summary_uses_real_strength():
    node = GraphNode("topic:ai", "topic", "AI safety", 10, {"strength_pct": 62})
    summary = synthesize_summary(node, [], [])
    assert "62%" in summary
