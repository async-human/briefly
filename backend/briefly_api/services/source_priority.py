"""User-set source priority (stored in sources.meta.priority)."""
from __future__ import annotations

from typing import Any

PRIORITY_HIGH = "high"
PRIORITY_NORMAL = "normal"
PRIORITY_LOW = "low"
VALID_PRIORITIES = {PRIORITY_HIGH, PRIORITY_NORMAL, PRIORITY_LOW}

# Max briefing items per source by priority
MAX_ITEMS_BY_PRIORITY = {
    PRIORITY_HIGH: 5,
    PRIORITY_NORMAL: 2,
    PRIORITY_LOW: 1,
}

# Floor/ceiling applied to the source engagement dimension in relevance scoring
RELEVANCE_FLOOR = {
    PRIORITY_HIGH: 0.82,
    PRIORITY_NORMAL: 0.5,
    PRIORITY_LOW: 0.25,
}
RELEVANCE_CEILING = {
    PRIORITY_HIGH: 1.0,
    PRIORITY_NORMAL: 1.0,
    PRIORITY_LOW: 0.45,
}


def normalize_priority(value: str | None) -> str:
    if value in VALID_PRIORITIES:
        return value
    return PRIORITY_NORMAL


def priority_from_source(source: Any) -> str:
    meta = getattr(source, "meta", None) or {}
    if isinstance(meta, dict):
        return normalize_priority(meta.get("priority"))
    return PRIORITY_NORMAL


def build_priority_map(sources: list[Any]) -> dict[str, str]:
    return {str(s.id): priority_from_source(s) for s in sources}


def max_items_for_source(source_id: str, priority_map: dict[str, str]) -> int:
    return MAX_ITEMS_BY_PRIORITY.get(priority_map.get(source_id, PRIORITY_NORMAL), 2)


def apply_priority_to_source_score(base_score: float, source_id: str, priority_map: dict[str, str]) -> float:
    priority = priority_map.get(source_id, PRIORITY_NORMAL)
    floor = RELEVANCE_FLOOR.get(priority, 0.5)
    ceiling = RELEVANCE_CEILING.get(priority, 1.0)
    return round(min(ceiling, max(floor, base_score)), 4)


def priority_sort_key(source_id: str, priority_map: dict[str, str]) -> int:
    """Lower sorts first — high-priority sources get Pool A slots before others."""
    order = {PRIORITY_HIGH: 0, PRIORITY_NORMAL: 1, PRIORITY_LOW: 2}
    return order.get(priority_map.get(source_id, PRIORITY_NORMAL), 1)
