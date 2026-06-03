"""Shared helpers for user profile JSONB fields (interests, topic_clusters)."""
from __future__ import annotations
import re

# Digest-routing labels that must never be treated as topic interests.
_INTERNAL_SECTION_LABELS: frozenset[str] = frozenset({
    "what's new",
    "highly relevant to you",
    "highly relevant",
    "whats new",
})

# UUID pattern — source_weights can store UUID keys from old data; skip them.
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def cluster_label(entry: dict) -> str | None:
    """Human-readable topic label; skip internal meta rows and section labels."""
    if not isinstance(entry, dict):
        return None
    if entry.get("_type") in {"source_weight", "meta"}:
        return None
    # Prefer explicit cluster/topic keys; avoid the `section` fallback which
    # leaks digest-routing labels ("What's new") into interest clusters.
    label = entry.get("cluster") or entry.get("topic") or entry.get("name")
    if not label:
        # Only use `section` if it's not a known internal label
        section = entry.get("section", "")
        if section and section.lower().strip() not in _INTERNAL_SECTION_LABELS:
            label = section
    if isinstance(label, str) and label.strip():
        clean = label.strip()
        if clean.lower() not in _INTERNAL_SECTION_LABELS and not _UUID_RE.match(clean):
            return clean
    return None


def iter_topic_clusters(topic_clusters: list[dict] | None) -> list[dict]:
    """Yield real topic cluster entries, skipping meta rows."""
    for entry in topic_clusters or []:
        if cluster_label(entry):
            yield entry
