"""Plain-language explanations for per-dimension relevance breakdowns."""
from __future__ import annotations

from typing import Any

_DIMENSION_LABELS = {
    "semantic": "Strong semantic match to your profile",
    "topic": "Strong match to your interest clusters",
    "quality": "High-quality source material",
    "recency": "Fresh story from today",
    "source": "From a source you engage with",
}

_WEIGHT_KEYS = ("semantic", "topic", "quality", "recency", "source")


def build_score_breakdown(
    *,
    semantic: float,
    topic: float,
    quality: float,
    recency: float,
    source: float,
    thread_boost: float = 0.0,
    deprioritized_penalty: float = 0.0,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    scores = {
        "semantic": round(semantic, 4),
        "topic": round(topic, 4),
        "quality": round(quality, 4),
        "recency": round(recency, 4),
        "source": round(source, 4),
        "thread_boost": round(thread_boost, 4),
        "deprioritized_penalty": round(deprioritized_penalty, 4),
    }
    w = weights or {
        "semantic": 0.45,
        "topic": 0.28,
        "quality": 0.10,
        "recency": 0.08,
        "source": 0.09,
    }
    contributions = {
        key: round(scores[key] * w.get(key, 0.0), 4) for key in _WEIGHT_KEYS
    }
    top_dimension = max(contributions, key=lambda k: contributions[k])
    return {
        **scores,
        "weights": w,
        "contributions": contributions,
        "top_dimension": top_dimension,
    }


def why_this_summary(breakdown: dict[str, Any] | None, *, source_name: str | None = None) -> str | None:
    if not breakdown:
        return None
    dim = breakdown.get("top_dimension")
    if dim == "source" and source_name:
        return f"From a source you engage with · {source_name}"
    label = _DIMENSION_LABELS.get(str(dim or ""))
    if not label:
        return None
    if dim == "topic":
        return f"{label}"
    return label
