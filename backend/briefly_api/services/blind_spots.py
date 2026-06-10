"""Cross-source blind-spot detection for the briefing pipeline."""
from __future__ import annotations

import re
from collections import defaultdict

_STOPWORDS = frozenset(
    "a an the and or for with from your our their about into over after before".split()
)


def _topic_key(text: str) -> str:
    words = [w for w in re.findall(r"[a-z0-9]{3,}", (text or "").lower()) if w not in _STOPWORDS]
    return " ".join(words[:4]) if words else ""


def detect_blind_spots(
    enriched_items: list,
    selected_item_ids: list[str],
    enrichment_cache: dict[str, dict],
    coverage_gaps: list[str] | None = None,
    *,
    max_spots: int = 2,
) -> list[dict]:
    """
    Find echo-chamber patterns: many aligned stories on a thread with a
    contrarian angle available in the pool but not in today's digest.
    """
    selected = set(selected_item_ids)
    thread_selected: dict[str, list[str]] = defaultdict(list)

    for cid in selected:
        cached = enrichment_cache.get(cid) or {}
        tk = (cached.get("thread_key") or "").strip().lower()
        if tk:
            thread_selected[tk].append(cid)

    blind_spots: list[dict] = []

    for thread_key, cids in thread_selected.items():
        if len(cids) < 3:
            continue
        if any(enrichment_cache.get(c, {}).get("contradiction_flag") for c in cids):
            continue

        counter: dict | None = None
        for item in enriched_items:
            if item.id in selected:
                continue
            cached = enrichment_cache.get(item.id) or {}
            if not cached.get("contradiction_flag"):
                continue
            item_thread = (cached.get("thread_key") or "").strip().lower()
            title_key = _topic_key(getattr(item, "title", ""))
            if item_thread == thread_key or thread_key in title_key or title_key in thread_key:
                counter = {
                    "headline": getattr(item, "title", ""),
                    "source": getattr(item, "source_name", ""),
                    "explanation": cached.get("contradiction_explanation") or "",
                    "content_id": item.id,
                }
                break

        if counter:
            blind_spots.append(
                {
                    "type": "consensus_gap",
                    "topic": thread_key.replace("_", " ").title(),
                    "consensus": (
                        f"{len(cids)} stories in today's brief align on this thread — "
                        "your sources are largely in agreement."
                    ),
                    "counter_headline": counter["headline"],
                    "counter_source": counter["source"],
                    "counter_argument": counter["explanation"],
                }
            )

        if len(blind_spots) >= max_spots:
            break

    for gap in (coverage_gaps or [])[:1]:
        if len(blind_spots) >= max_spots:
            break
        if not gap or any(b.get("topic", "").lower() == gap.lower() for b in blind_spots):
            continue
        blind_spots.append(
            {
                "type": "coverage_gap",
                "topic": gap,
                "consensus": f"You've declared interest in {gap}, but nothing matched in recent briefings.",
                "counter_headline": None,
                "counter_source": None,
                "counter_argument": (
                    "Consider adding a source that covers this area, or check if your filters are too narrow."
                ),
            }
        )

    return blind_spots[:max_spots]
