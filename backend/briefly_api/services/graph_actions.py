"""User actions from the knowledge graph — steer Briefly's learning."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from briefly_api.db.models import Source, UserProfile
from briefly_api.services.profile_utils import cluster_label
from briefly_api.services.source_priority import normalize_priority


def _find_cluster(clusters: list[dict], topic: str) -> dict | None:
    key = topic.strip().lower()
    for entry in clusters:
        label = cluster_label(entry)
        if label and label.lower() == key:
            return entry
    return None


async def boost_topic(profile: UserProfile, topic: str) -> dict:
    topic = topic.strip()
    if not topic:
        raise ValueError("Topic is required.")

    clusters = [c for c in (profile.topic_clusters or []) if not c.get("_type")]
    entry = _find_cluster(clusters, topic)
    if entry:
        entry["strength"] = round(min(1.0, float(entry.get("strength", 0.3)) + 0.15), 4)
        strength = entry["strength"]
    else:
        strength = 0.55
        clusters.append(
            {
                "cluster": topic,
                "strength": strength,
                "source": "learned",
                "item_count": 0,
            }
        )

    meta_rows = [c for c in (profile.topic_clusters or []) if c.get("_type") in {"source_weight", "meta"}]
    clusters.sort(key=lambda x: x.get("strength", 0), reverse=True)
    profile.topic_clusters = meta_rows + clusters[:30]
    flag_modified(profile, "topic_clusters")
    return {"topic": topic, "action": "boost", "strength": strength}


async def mute_topic(profile: UserProfile, topic: str) -> dict:
    topic = topic.strip()
    if not topic:
        raise ValueError("Topic is required.")

    clusters = [c for c in (profile.topic_clusters or []) if not c.get("_type")]
    entry = _find_cluster(clusters, topic)
    strength = 0.0
    if entry:
        strength = round(max(0.0, float(entry.get("strength", 0.3)) - 0.25), 4)
        entry["strength"] = strength

    never = list(profile.never_show or [])
    lowered = topic.lower()
    if lowered not in never:
        never.append(lowered)
    profile.never_show = never

    meta_rows = [c for c in (profile.topic_clusters or []) if c.get("_type") in {"source_weight", "meta"}]
    profile.topic_clusters = meta_rows + clusters
    flag_modified(profile, "topic_clusters")
    flag_modified(profile, "never_show")
    return {"topic": topic, "action": "mute", "strength": strength}


async def set_source_graph_priority(
    db: AsyncSession,
    profile: UserProfile | None,
    user_id: str,
    source_id: str,
    action: str,
) -> dict:
    if action not in {"prioritize", "deprioritize"}:
        raise ValueError("Invalid source action.")

    result = await db.execute(
        select(Source).where(Source.id == source_id, Source.user_id == user_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise ValueError("Source not found.")

    priority = "high" if action == "prioritize" else "low"
    meta = dict(source.meta or {})
    meta["priority"] = normalize_priority(priority)
    source.meta = meta
    flag_modified(source, "meta")

    weight = 0.85 if action == "prioritize" else 0.2
    if profile:
        weights = dict(profile.source_weights or {})
        weights[source_id] = weight
        profile.source_weights = weights
        flag_modified(profile, "source_weights")

    return {"source_id": source_id, "action": action, "priority": meta["priority"], "weight": weight}
