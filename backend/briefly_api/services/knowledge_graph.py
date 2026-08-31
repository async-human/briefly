"""
briefly_api/services/knowledge_graph.py

Assemble an interactive knowledge graph from existing Briefly data:
topic clusters, sources, content items, brain dumps, and story threads.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.services.topic_matching import topic_match_score, topics_for_digest_item
from briefly_api.db.models import (
    ContentEmbedding,
    ContentEnrichmentCache,
    Digest,
    DigestItem,
    RawContent,
    Source,
    UserMemory,
    UserProfile,
    WatchedEntity,
)
from briefly_api.services.profile_utils import cluster_label, iter_topic_clusters
from briefly_api.services.watch.catalog import match_terms_for

from briefly_api.services.connectors.types import INTERNAL_SOURCE_TYPES
SIMILARITY_THRESHOLD = 0.72
MAX_TOPICS = 12
MAX_THREADS = 10
MAX_SOURCES = 18
MAX_ITEMS = 70
MAX_THOUGHTS = 20
MAX_ENTITIES = 40
MAX_SIMILARITY_EDGES = 60


def _slug(value: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "-", value.lower().strip())
    return clean.strip("-")[:96] or "unknown"


def _topic_match_score(text: str, topic: str) -> float:
    return topic_match_score(text, topic)


def _parse_iso_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _item_occurred_at(raw: RawContent | None, digest_date: str | None) -> str | None:
    if raw and raw.ingested_at:
        return raw.ingested_at.isoformat()
    if digest_date:
        return f"{digest_date}T12:00:00+00:00"
    return None


def filter_graph_by_days(graph: KnowledgeGraph, days: int) -> KnowledgeGraph:
    """Keep nodes inside a time window; retain anchors connected to recent activity."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    kept: set[str] = set()

    for node in graph.nodes:
        if node.type in {"item", "thought"}:
            ts = _parse_iso_dt(node.meta.get("occurred_at") or node.meta.get("created_at"))
            if ts and ts >= cutoff:
                kept.add(node.id)
        elif node.type == "thread":
            ts = _parse_iso_dt(node.meta.get("last_seen_at") or node.meta.get("first_seen"))
            if ts and ts >= cutoff:
                kept.add(node.id)
        elif node.type == "entity":
            kept.add(node.id)

    if not kept:
        return KnowledgeGraph(nodes=[], edges=[], stats={**graph.stats, "time_window_days": days})

    anchor_types = {"topic", "thread", "source", "entity"}
    node_by_id = {n.id: n for n in graph.nodes}
    changed = True
    while changed:
        changed = False
        for edge in graph.edges:
            if edge.source in kept and edge.target not in kept:
                target = node_by_id.get(edge.target)
                if target and target.type in anchor_types:
                    kept.add(edge.target)
                    changed = True
            elif edge.target in kept and edge.source not in kept:
                source = node_by_id.get(edge.source)
                if source and source.type in anchor_types:
                    kept.add(edge.source)
                    changed = True

    nodes = [n for n in graph.nodes if n.id in kept]
    node_ids = {n.id for n in nodes}
    edges = [e for e in graph.edges if e.source in node_ids and e.target in node_ids]
    stats = {
        **graph.stats,
        "time_window_days": days,
        "topic_count": sum(1 for n in nodes if n.type == "topic"),
        "thread_count": sum(1 for n in nodes if n.type == "thread"),
        "item_count": sum(1 for n in nodes if n.type == "item"),
        "thought_count": sum(1 for n in nodes if n.type == "thought"),
        "source_count": sum(1 for n in nodes if n.type == "source"),
        "entity_count": sum(1 for n in nodes if n.type == "entity"),
        "edge_count": len(edges),
    }
    return KnowledgeGraph(nodes=nodes, edges=edges, stats=stats)


def text_mentions(blob: str, terms: list[str]) -> bool:
    """True if any watch term appears in text. Short terms need a word boundary."""
    if not blob or not terms:
        return False
    low = blob.lower()
    for term in terms:
        t = (term or "").lower().strip()
        if len(t) < 3:
            continue
        if len(t) <= 4:
            if re.search(rf"\b{re.escape(t)}\b", low):
                return True
        elif t in low:
            return True
    return False


def _cosine(a: list[float], b: list[float]) -> float:
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


@dataclass
class GraphNode:
    id: str
    type: str
    label: str
    size: float
    meta: dict = field(default_factory=dict)


@dataclass
class GraphEdge:
    id: str
    source: str
    target: str
    type: str
    weight: float
    label: str | None = None


@dataclass
class KnowledgeGraph:
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    stats: dict


class _GraphBuilder:
    def __init__(self) -> None:
        self.nodes: dict[str, GraphNode] = {}
        self.edges: dict[str, GraphEdge] = {}
        self._topic_ids: dict[str, str] = {}
        self._thread_ids: dict[str, str] = {}

    def add_node(self, node: GraphNode) -> None:
        self.nodes.setdefault(node.id, node)

    def add_edge(
        self,
        source: str,
        target: str,
        edge_type: str,
        weight: float,
        *,
        label: str | None = None,
    ) -> None:
        if source not in self.nodes or target not in self.nodes:
            return
        if source == target:
            return
        edge_id = f"{edge_type}:{source}->{target}"
        existing = self.edges.get(edge_id)
        if existing:
            existing.weight = max(existing.weight, weight)
            return
        self.edges[edge_id] = GraphEdge(
            id=edge_id,
            source=source,
            target=target,
            type=edge_type,
            weight=round(min(1.0, max(0.05, weight)), 3),
            label=label,
        )

    def topic_id(self, label: str) -> str:
        key = label.lower().strip()
        if key not in self._topic_ids:
            node_id = f"topic:{_slug(label)}"
            self._topic_ids[key] = node_id
        return self._topic_ids[key]

    def thread_id(self, key: str, label: str) -> str:
        norm = key.lower().strip()
        if norm not in self._thread_ids:
            node_id = f"thread:{_slug(key)}"
            self._thread_ids[norm] = node_id
        return self._thread_ids[norm]


async def build_knowledge_graph(
    db: AsyncSession,
    user_id: str,
    profile: UserProfile | None,
    *,
    days: int | None = None,
) -> KnowledgeGraph:
    builder = _GraphBuilder()

    clusters = list(iter_topic_clusters((profile.topic_clusters if profile else None) or []))
    if not clusters and profile and profile.interests:
        clusters = [
            {
                "cluster": i.get("topic", ""),
                "strength": float(i.get("weight", 0.5)),
                "source": "declared",
                "item_count": 0,
            }
            for i in profile.interests
            if i.get("topic")
        ]

    clusters = sorted(clusters, key=lambda c: c.get("strength", 0), reverse=True)[:MAX_TOPICS]
    topic_labels: list[str] = []

    for cluster in clusters:
        label = cluster_label(cluster)
        if not label:
            continue
        topic_labels.append(label)
        node_id = builder.topic_id(label)
        strength = float(cluster.get("strength", 0.3))
        item_count = int(cluster.get("item_count", 0))
        builder.add_node(
            GraphNode(
                id=node_id,
                type="topic",
                label=label,
                size=8 + strength * 20,
                meta={
                    "strength": round(strength, 3),
                    "strength_pct": round(strength * 100),
                    "item_count": item_count,
                    "source": cluster.get("source", "learned"),
                    "first_seen": cluster.get("first_seen"),
                },
            )
        )

    watched_result = await db.execute(
        select(WatchedEntity)
        .where(WatchedEntity.user_id == user_id, WatchedEntity.is_active.is_(True))
        .order_by(WatchedEntity.created_at.desc())
        .limit(MAX_ENTITIES)
    )
    watched_rows = watched_result.scalars().all()
    entity_terms: list[tuple[str, list[str]]] = []

    for ent in watched_rows:
        node_id = f"entity:{ent.id}"
        terms = match_terms_for(
            ent.name,
            ent.kind,
            list(ent.keywords or []),
            list(ent.aliases or []),
        )
        builder.add_node(
            GraphNode(
                id=node_id,
                type="entity",
                label=ent.name,
                size=11,
                meta={
                    "kind": ent.kind,
                    "watched_id": ent.id,
                    "watching": True,
                    "keywords": list(ent.keywords or [])[:8],
                },
            )
        )
        entity_terms.append((node_id, terms))
        for topic in topic_labels:
            score = _topic_match_score(ent.name, topic)
            if score >= 0.34:
                builder.add_edge(
                    node_id,
                    builder.topic_id(topic),
                    "watches",
                    0.4 + score * 0.4,
                    label="watching",
                )

    thread_result = await db.execute(
        select(UserMemory)
        .where(UserMemory.user_id == user_id, UserMemory.memory_type == "story_thread")
        .order_by(UserMemory.occurrence_count.desc())
        .limit(MAX_THREADS)
    )
    threads = thread_result.scalars().all()
    thread_label_by_key: dict[str, str] = {}

    for thread in threads:
        val = thread.value or {}
        label = (val.get("topic") or thread.key or "Story thread").strip()
        thread_label_by_key[thread.key.lower().strip()] = label
        node_id = builder.thread_id(thread.key, label)
        builder.add_node(
            GraphNode(
                id=node_id,
                type="thread",
                label=label,
                size=10 + min(thread.occurrence_count, 12) * 2.5,
                meta={
                    "appearances": thread.occurrence_count,
                    "latest_headline": (val.get("latest_headline") or "")[:160],
                    "first_seen": val.get("first_seen") or thread.first_seen_at.isoformat(),
                    "last_seen_at": thread.last_seen_at.isoformat(),
                    "health": val.get("health", "active"),
                },
            )
        )

        best_topic = None
        best_score = 0.0
        for topic in topic_labels:
            score = _topic_match_score(label, topic)
            if score > best_score:
                best_score = score
                best_topic = topic
        if best_topic and best_score >= 0.34:
            builder.add_edge(
                node_id,
                builder.topic_id(best_topic),
                "part_of",
                0.45 + best_score * 0.4,
                label="Story thread",
            )

    source_result = await db.execute(
        select(Source)
        .where(Source.user_id == user_id)
        .order_by(Source.created_at.desc())
    )
    sources = source_result.scalars().all()
    source_nodes: dict[str, str] = {}

    for src in sources:
        if src.source_type in INTERNAL_SOURCE_TYPES:
            display = "Saved links" if src.source_type == "browser_capture" else "Your thoughts"
            node_id = f"source:{src.source_type}"
        else:
            node_id = f"source:{src.id}"
            display = src.name or src.identifier or src.source_type

        if node_id in source_nodes:
            source_nodes[src.id] = node_id
            continue

        weight = 0.5
        if profile and profile.source_weights:
            for key, val in profile.source_weights.items():
                if key == src.id or (display and key.lower() == display.lower()):
                    weight = max(weight, float(val))

        source_nodes[src.id] = node_id
        if node_id not in builder.nodes and len([n for n in builder.nodes.values() if n.type == "source"]) < MAX_SOURCES:
            builder.add_node(
                GraphNode(
                    id=node_id,
                    type="source",
                    label=display,
                    size=8 + weight * 14,
                    meta={
                        "source_type": src.source_type,
                        "source_id": src.id,
                        "weight": round(weight, 3),
                        "identifier": src.identifier,
                    },
                )
            )

    digest_result = await db.execute(
        select(Digest)
        .where(Digest.user_id == user_id, Digest.status.in_(["ready", "sent"]))
        .options(selectinload(Digest.items))
        .order_by(Digest.digest_date.desc())
        .limit(14)
    )
    digests = digest_result.scalars().all()

    item_candidates: list[dict] = []
    content_ids: set[str] = set()

    for digest in digests:
        for item in digest.items:
            if not item.content_id:
                continue
            engagement = (
                (2.0 if item.was_saved else 0.0)
                + (1.5 if item.was_clicked else 0.0)
                + (2.5 if item.had_follow_up else 0.0)
                + min(item.follow_up_depth, 4) * 0.5
                + (item.relevance_score or 0.0) * 0.5
            )
            item_candidates.append(
                {
                    "content_id": item.content_id,
                    "digest_item_id": item.id,
                    "headline": item.headline,
                    "summary": item.summary,
                    "source_name": item.source_name,
                    "url": item.source_url,
                    "engagement": engagement,
                    "memory_connections": item.memory_connections or [],
                    "memory_reference": item.memory_reference,
                    "section": item.section,
                    "confidence_signal": item.confidence_signal,
                    "digest_date": digest.digest_date,
                }
            )
            content_ids.add(item.content_id)

    capture_source = next((s for s in sources if s.source_type == "browser_capture"), None)
    if capture_source:
        cap_result = await db.execute(
            select(RawContent)
            .where(RawContent.user_id == user_id, RawContent.source_id == capture_source.id)
            .order_by(RawContent.ingested_at.desc())
            .limit(30)
        )
        for row in cap_result.scalars().all():
            meta = row.meta or {}
            if not meta.get("browser_capture"):
                continue
            if row.id in content_ids:
                continue
            item_candidates.append(
                {
                    "content_id": row.id,
                    "digest_item_id": None,
                    "headline": row.title or "Saved article",
                    "summary": (row.summary or row.clean_text or "")[:400],
                    "source_name": "Saved links",
                    "url": row.url,
                    "engagement": 2.0 if meta.get("user_note") else 1.2,
                    "memory_connections": [],
                    "memory_reference": None,
                    "section": meta.get("section"),
                    "digest_date": None,
                    "is_capture": True,
                }
            )
            content_ids.add(row.id)

    item_candidates.sort(key=lambda x: x["engagement"], reverse=True)
    selected_items = item_candidates[:MAX_ITEMS]
    selected_content_ids = [i["content_id"] for i in selected_items]

    content_result = await db.execute(
        select(RawContent)
        .where(RawContent.id.in_(selected_content_ids))
        .options(selectinload(RawContent.source))
    ) if selected_content_ids else None
    contents_by_id = {r.id: r for r in content_result.scalars().all()} if content_result else {}

    enrich_result = await db.execute(
        select(ContentEnrichmentCache).where(
            ContentEnrichmentCache.user_id == user_id,
            ContentEnrichmentCache.content_id.in_(selected_content_ids),
        )
    ) if selected_content_ids else None
    enrich_by_id = {e.content_id: e for e in enrich_result.scalars().all()} if enrich_result else {}

    for cand in selected_items:
        cid = cand["content_id"]
        raw = contents_by_id.get(cid)
        enrichment = enrich_by_id.get(cid)
        headline = (cand["headline"] or "Untitled")[:120]
        node_id = f"item:{cid}"
        engagement = cand["engagement"]
        builder.add_node(
            GraphNode(
                id=node_id,
                type="item",
                label=headline,
                size=4 + min(engagement, 6) * 1.2,
                meta={
                    "url": cand["url"] or (raw.url if raw else None),
                    "summary": (cand["summary"] or "")[:220],
                    "source_name": cand["source_name"],
                    "digest_date": cand["digest_date"],
                    "occurred_at": _item_occurred_at(raw, cand["digest_date"]),
                    "engagement": round(engagement, 2),
                    "was_saved": bool(raw and (raw.meta or {}).get("saved")),
                    "connection_sentence": enrichment.connection_sentence if enrichment else None,
                    "why_relevant": enrichment.why_relevant if enrichment else None,
                    "memory_reference": cand.get("memory_reference"),
                    "is_capture": cand.get("is_capture", False),
                },
            )
        )

        if raw and raw.source_id in source_nodes:
            builder.add_edge(
                source_nodes[raw.source_id],
                node_id,
                "produces",
                0.35 + min(engagement, 4) * 0.08,
                label="Published",
            )

        text_blob = f"{headline} {cand['summary'] or ''}"
        matched_topics = topics_for_digest_item(
            cand["headline"],
            cand["summary"],
            cand["source_name"],
            cand.get("confidence_signal"),
            topic_labels,
        )
        if not matched_topics:
            best_topic = None
            best_score = 0.0
            for topic in topic_labels:
                score = _topic_match_score(text_blob, topic)
                if score > best_score:
                    best_score = score
                    best_topic = topic
            if best_topic and best_score >= 0.5:
                matched_topics = [best_topic]

        for topic in matched_topics:
            score = _topic_match_score(text_blob, topic) or 0.5
            builder.add_edge(
                node_id,
                builder.topic_id(topic),
                "belongs_to",
                0.3 + score * 0.55,
                label="In your brief",
            )

        thread_key = enrichment.thread_key if enrichment else None
        if thread_key:
            t_norm = thread_key.lower().strip()
            if t_norm in thread_label_by_key:
                tid = builder.thread_id(thread_key, thread_label_by_key[t_norm])
                builder.add_edge(
                    node_id,
                    tid,
                    "updates",
                    0.5 + (enrichment.connection_strength if enrichment else 0.3),
                    label=enrichment.thread_update if enrichment else "Thread update",
                )

        connections = list(cand["memory_connections"])
        if enrichment and enrichment.memory_connections:
            connections.extend(enrichment.memory_connections)
        for conn in connections:
            thread_key = conn.get("thread_key")
            if isinstance(thread_key, str) and thread_key.strip():
                t_norm = thread_key.lower().strip()
                if t_norm in thread_label_by_key:
                    tid = builder.thread_id(thread_key, thread_label_by_key[t_norm])
                    builder.add_edge(
                        node_id,
                        tid,
                        "updates",
                        0.55,
                        label=conn.get("description") or "Thread connection",
                    )

        mention_blob = f"{headline} {cand['summary'] or ''}"
        for entity_id, terms in entity_terms:
            if text_mentions(mention_blob, terms):
                builder.add_edge(
                    entity_id,
                    node_id,
                    "mentioned_with",
                    0.55,
                    label="mentioned with",
                )

    brain_source = next((s for s in sources if s.source_type == "brain_dump"), None)
    if brain_source:
        dump_result = await db.execute(
            select(RawContent)
            .where(RawContent.user_id == user_id, RawContent.source_id == brain_source.id)
            .order_by(RawContent.ingested_at.desc())
            .limit(MAX_THOUGHTS)
        )
        for row in dump_result.scalars().all():
            meta = row.meta or {}
            if not meta.get("brain_dump"):
                continue
            node_id = f"thought:{row.id}"
            title = (row.title or meta.get("title") or "Your thought")[:100]
            keywords = meta.get("relevance_keywords") or []
            builder.add_node(
                GraphNode(
                    id=node_id,
                    type="thought",
                    label=title,
                    size=9,
                    meta={
                        "summary": (row.summary or meta.get("clean_summary") or "")[:220],
                        "intent_type": meta.get("intent_type"),
                        "keywords": keywords[:6],
                        "created_at": (row.ingested_at or datetime.now(timezone.utc)).isoformat(),
                        "input_mode": meta.get("input_mode", "text"),
                    },
                )
            )

            thought_src = source_nodes.get(brain_source.id)
            if thought_src:
                builder.add_edge(thought_src, node_id, "captures", 0.7, label="You wrote")

            blob = f"{title} {' '.join(keywords)} {row.summary or ''}"
            for topic in topic_labels:
                score = _topic_match_score(blob, topic)
                if score >= 0.34:
                    builder.add_edge(
                        node_id,
                        builder.topic_id(topic),
                        "relates_to",
                        0.35 + score * 0.5,
                        label="Your interest",
                    )
            for entity_id, terms in entity_terms:
                if text_mentions(blob, terms):
                    builder.add_edge(
                        entity_id,
                        node_id,
                        "mentioned_with",
                        0.5,
                        label="mentioned with",
                    )

    sim_edges_added = 0
    if selected_content_ids:
        emb_result = await db.execute(
            select(ContentEmbedding).where(ContentEmbedding.content_id.in_(selected_content_ids))
        )
        embeddings = {e.content_id: e.embedding for e in emb_result.scalars().all()}
        ids = [cid for cid in selected_content_ids if cid in embeddings]
        for i, id_a in enumerate(ids):
            if sim_edges_added >= MAX_SIMILARITY_EDGES:
                break
            emb_a = embeddings[id_a]
            best: list[tuple[str, float]] = []
            for id_b in ids[i + 1 :]:
                sim = _cosine(emb_a, embeddings[id_b])
                if sim >= SIMILARITY_THRESHOLD:
                    best.append((id_b, sim))
            best.sort(key=lambda x: x[1], reverse=True)
            for id_b, sim in best[:2]:
                builder.add_edge(
                    f"item:{id_a}",
                    f"item:{id_b}",
                    "related_to",
                    (sim - SIMILARITY_THRESHOLD) / (1 - SIMILARITY_THRESHOLD) * 0.6 + 0.25,
                    label="Semantically similar",
                )
                sim_edges_added += 1
                if sim_edges_added >= MAX_SIMILARITY_EDGES:
                    break

    nodes = list(builder.nodes.values())
    edges = list(builder.edges.values())
    stats = {
        "digest_day": profile.total_digests_received if profile else 0,
        "topic_count": sum(1 for n in nodes if n.type == "topic"),
        "thread_count": sum(1 for n in nodes if n.type == "thread"),
        "item_count": sum(1 for n in nodes if n.type == "item"),
        "thought_count": sum(1 for n in nodes if n.type == "thought"),
        "source_count": sum(1 for n in nodes if n.type == "source"),
        "entity_count": sum(1 for n in nodes if n.type == "entity"),
        "edge_count": len(edges),
        "items_total_candidates": len(item_candidates),
        "items_displayed": len(selected_items),
        "digests_scanned": len(digests),
        "similarity_edges_capped": sim_edges_added >= MAX_SIMILARITY_EDGES if selected_content_ids else False,
    }

    graph = KnowledgeGraph(nodes=nodes, edges=edges, stats=stats)
    if days is not None:
        graph = filter_graph_by_days(graph, days)
    return graph


def graph_to_dict(graph: KnowledgeGraph) -> dict:
    return {
        "nodes": [
            {
                "id": n.id,
                "type": n.type,
                "label": n.label,
                "size": round(n.size, 2),
                "meta": n.meta,
            }
            for n in graph.nodes
        ],
        "edges": [
            {
                "id": e.id,
                "source": e.source,
                "target": e.target,
                "type": e.type,
                "weight": e.weight,
                "label": e.label,
            }
            for e in graph.edges
        ],
        "stats": graph.stats,
    }
