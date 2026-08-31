"""Synthesize an Entity Hub profile from the computed knowledge graph.

Level 2 of progressive disclosure: a structured dashboard for one node,
not a list of raw links. Built on read from Postgres — no graph database.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import EntityAlert, UserProfile, WatchedEntity
from briefly_api.services.knowledge_graph import (
    GraphNode,
    KnowledgeGraph,
    _parse_iso_dt,
    build_knowledge_graph,
)

_HUB_PREF = ("entity", "topic", "thread", "source", "thought", "item")
_CHIP_TYPES = {"entity", "topic", "thread", "source"}
_MAX_TIMELINE = 8
_MAX_CONNECTED = 10
_MAX_MEMORY = 6


def relative_when(iso: str | None, now: datetime | None = None) -> str:
    dt = _parse_iso_dt(iso)
    if not dt:
        return "Earlier"
    now = now or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    days = (now - dt).days
    if days <= 0:
        return "Today"
    if days == 1:
        return "Yesterday"
    if days < 7:
        return f"{days} days ago"
    if days < 14:
        return "Last week"
    if days < 45:
        weeks = max(2, days // 7)
        return f"{weeks} weeks ago"
    return dt.strftime("%b %d")


def resolve_hub_node(
    graph: KnowledgeGraph,
    *,
    node_id: str | None = None,
    q: str | None = None,
) -> GraphNode | None:
    if node_id:
        for node in graph.nodes:
            if node.id == node_id:
                return node
    query = (q or "").strip()
    if not query:
        return None
    low = query.lower()
    ranked: list[tuple[int, GraphNode]] = []
    for node in graph.nodes:
        label = node.label.lower()
        if label == low:
            ranked.append((0, node))
        elif low in label or label in low:
            ranked.append((1, node))
    if not ranked:
        return None
    type_rank = {t: i for i, t in enumerate(_HUB_PREF)}
    ranked.sort(key=lambda pair: (pair[0], type_rank.get(pair[1].type, 99)))
    return ranked[0][1]


def _neighbors(graph: KnowledgeGraph, node_id: str) -> list[tuple[GraphNode, str]]:
    by_id = {n.id: n for n in graph.nodes}
    out: list[tuple[GraphNode, str]] = []
    seen: set[str] = set()
    for edge in graph.edges:
        other_id = None
        if edge.source == node_id:
            other_id = edge.target
        elif edge.target == node_id:
            other_id = edge.source
        if not other_id or other_id in seen:
            continue
        other = by_id.get(other_id)
        if not other:
            continue
        seen.add(other_id)
        out.append((other, edge.label or edge.type))
    return out


def synthesize_summary(
    node: GraphNode,
    timeline: list[dict],
    memory: list[dict],
) -> str:
    if node.type == "entity":
        kind = str(node.meta.get("kind") or "company").replace("_", " ")
        if timeline:
            return f"{kind.capitalize()} you're watching. Latest: {timeline[0]['title']}"
        return f"{kind.capitalize()} you're watching."
    if node.type == "topic":
        pct = node.meta.get("strength_pct")
        if pct is not None:
            return f"Interest in your brief ({pct}% strength)."
        return "Interest in your brief."
    if node.type == "thread":
        headline = node.meta.get("latest_headline")
        if headline:
            return str(headline)[:220]
        return "An ongoing story in your brief."
    if node.type == "item":
        sentence = node.meta.get("connection_sentence") or node.meta.get("summary")
        if sentence:
            return str(sentence)[:240]
    if node.type == "thought":
        summary = node.meta.get("summary")
        if summary:
            return str(summary)[:240]
        return "A note you saved."
    if node.type == "source":
        source_type = node.meta.get("source_type")
        if source_type:
            return f"A {source_type} source in your brief."
        return "A source in your brief."
    if timeline:
        return f"Latest: {timeline[0]['title']}"
    if memory:
        return str(memory[0].get("text") or "")[:240]
    return ""


def assemble_hub(
    graph: KnowledgeGraph,
    node: GraphNode,
    *,
    alerts: list[dict] | None = None,
    now: datetime | None = None,
) -> dict:
    now = now or datetime.now(timezone.utc)
    neighbors = _neighbors(graph, node.id)

    timeline: list[dict] = []
    for alert in alerts or []:
        linked = [label for label in (alert.get("linked") or []) if label]
        timeline.append(
            {
                "when": relative_when(alert.get("occurred_at"), now),
                "title": alert["title"],
                "node_id": alert.get("node_id"),
                "linked": linked[:4],
                "source": alert.get("source"),
                "occurred_at": alert.get("occurred_at"),
            }
        )

    for other, edge_label in neighbors:
        if other.type != "item":
            continue
        linked_labels: list[str] = []
        for related, _ in _neighbors(graph, other.id):
            if related.id == node.id:
                continue
            if related.type in {"entity", "topic", "thread"}:
                linked_labels.append(related.label)
        timeline.append(
            {
                "when": relative_when(
                    other.meta.get("occurred_at") or other.meta.get("digest_date"),
                    now,
                ),
                "title": other.label,
                "node_id": other.id,
                "linked": linked_labels[:4],
                "source": other.meta.get("source_name"),
                "occurred_at": other.meta.get("occurred_at") or other.meta.get("digest_date"),
            }
        )

    def _ts(entry: dict) -> str:
        return str(entry.get("occurred_at") or "")

    timeline.sort(key=_ts, reverse=True)
    timeline = timeline[:_MAX_TIMELINE]
    for entry in timeline:
        entry.pop("occurred_at", None)

    connected: list[dict] = []
    for other, edge_label in neighbors:
        if other.type not in _CHIP_TYPES:
            continue
        connected.append(
            {
                "id": other.id,
                "label": other.label,
                "type": other.type,
                "kind": other.meta.get("kind"),
                "edge_label": edge_label,
            }
        )
    connected = connected[:_MAX_CONNECTED]

    memory: list[dict] = []
    seen_text: set[str] = set()

    def _add_memory(text: str | None, kind: str, saved_at: str, node_id: str | None = None) -> None:
        clean = (text or "").strip()
        if not clean or clean.lower() in seen_text:
            return
        seen_text.add(clean.lower())
        memory.append(
            {
                "text": clean[:280],
                "kind": kind,
                "saved_at": saved_at,
                "node_id": node_id,
            }
        )

    own_ref = node.meta.get("memory_reference")
    if own_ref:
        _add_memory(str(own_ref), "note", "From this story", node.id)

    for other, _ in neighbors:
        if other.type == "thought":
            _add_memory(
                other.meta.get("summary") or other.label,
                "thought",
                relative_when(other.meta.get("created_at"), now),
                other.id,
            )
        if other.type == "item" and other.meta.get("memory_reference"):
            _add_memory(
                str(other.meta["memory_reference"]),
                "note",
                relative_when(other.meta.get("occurred_at"), now),
                other.id,
            )
        if other.type == "thread":
            headline = other.meta.get("latest_headline")
            _add_memory(
                str(headline) if headline else other.label,
                "thread",
                relative_when(other.meta.get("last_seen_at") or other.meta.get("first_seen"), now),
                other.id,
            )

    watching = bool(node.meta.get("watching")) or node.type == "entity"
    watched_id = node.meta.get("watched_id") if node.type == "entity" else None
    if not isinstance(watched_id, str):
        watched_id = None

    kind = str(node.meta.get("kind") or node.type)

    return {
        "id": node.id,
        "name": node.label,
        "kind": kind,
        "type": node.type,
        "summary": synthesize_summary(node, timeline, memory[:_MAX_MEMORY]),
        "watching": watching,
        "watched_id": watched_id,
        "timeline": timeline,
        "connected": connected,
        "memory": memory[:_MAX_MEMORY],
        "meta": {
            "url": node.meta.get("url"),
            "source_id": node.meta.get("source_id"),
            "source_name": node.meta.get("source_name"),
        },
    }


async def build_entity_hub(
    db: AsyncSession,
    user_id: str,
    profile: UserProfile | None,
    *,
    node_id: str | None = None,
    q: str | None = None,
    days: int | None = None,
) -> dict | None:
    graph = await build_knowledge_graph(db, user_id, profile, days=days)
    node = resolve_hub_node(graph, node_id=node_id, q=q)
    if node is None:
        return None

    alerts: list[dict] = []
    watched_id = node.meta.get("watched_id") if node.type == "entity" else None
    if isinstance(watched_id, str):
        alert_result = await db.execute(
            select(EntityAlert)
            .where(EntityAlert.user_id == user_id, EntityAlert.entity_id == watched_id)
            .order_by(EntityAlert.created_at.desc())
            .limit(_MAX_TIMELINE)
        )
        for row in alert_result.scalars().all():
            alerts.append(
                {
                    "title": row.title,
                    "occurred_at": (row.published_at or row.created_at).isoformat()
                    if (row.published_at or row.created_at)
                    else None,
                    "source": row.source_name,
                    "node_id": None,
                    "linked": [],
                }
            )
    elif q or node.type in {"topic", "thread"}:
        # If the user opened a topic that matches a watched company, surface those alerts too.
        match = await db.execute(
            select(WatchedEntity).where(
                WatchedEntity.user_id == user_id,
                WatchedEntity.is_active.is_(True),
            )
        )
        for ent in match.scalars().all():
            if ent.name.lower() != node.label.lower():
                continue
            alert_result = await db.execute(
                select(EntityAlert)
                .where(EntityAlert.user_id == user_id, EntityAlert.entity_id == ent.id)
                .order_by(EntityAlert.created_at.desc())
                .limit(4)
            )
            for row in alert_result.scalars().all():
                alerts.append(
                    {
                        "title": row.title,
                        "occurred_at": (row.published_at or row.created_at).isoformat()
                        if (row.published_at or row.created_at)
                        else None,
                        "source": row.source_name,
                        "node_id": None,
                        "linked": [],
                    }
                )
            break

    return assemble_hub(graph, node, alerts=alerts)
