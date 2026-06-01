"""Shared helpers for user profile JSONB fields (interests, topic_clusters)."""
from __future__ import annotations


def cluster_label(entry: dict) -> str | None:
    """Human-readable topic label; skip internal meta rows."""
    if not isinstance(entry, dict):
        return None
    if entry.get("_type") in {"source_weight", "meta"}:
        return None
    label = entry.get("cluster") or entry.get("topic") or entry.get("section") or entry.get("name")
    if isinstance(label, str) and label.strip():
        return label.strip()
    return None


def iter_topic_clusters(topic_clusters: list[dict] | None) -> list[dict]:
    """Yield real topic cluster entries, skipping meta rows."""
    for entry in topic_clusters or []:
        if cluster_label(entry):
            yield entry
