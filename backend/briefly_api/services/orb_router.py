"""
briefly_api/services/orb_router.py

Semantic routing for orb turns: embed the transcript and match against tool
descriptions. Regex fast_patterns remain as zero-latency overrides.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Literal

from briefly_api.config import get_settings
from briefly_api.services.orb_tools import DATA_TOOLS, OrbTool

log = logging.getLogger(__name__)

RouteKind = Literal["direct", "agent", "ask_briefly"]

_TOOL_EMBEDDINGS: dict[str, list[float]] | None = None


@dataclass(frozen=True)
class RouteDecision:
    kind: RouteKind
    tools: tuple[OrbTool, ...] = ()
    confidence: float = 0.0
    reason: str = ""


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def regex_matches(transcript: str) -> list[OrbTool]:
    return [t for t in DATA_TOOLS if t.matches(transcript)]


async def _ensure_tool_embeddings() -> dict[str, list[float]]:
    global _TOOL_EMBEDDINGS
    if _TOOL_EMBEDDINGS is not None:
        return _TOOL_EMBEDDINGS
    from briefly_api.embeddings.adapter import get_embedding_adapter

    embedder = get_embedding_adapter()
    texts = [f"{t.name}: {t.description}" for t in DATA_TOOLS]
    try:
        vectors = await embedder.embed_batch(texts)
        _TOOL_EMBEDDINGS = {t.name: v for t, v in zip(DATA_TOOLS, vectors)}
    except Exception:
        log.debug("orb router embedding init failed", exc_info=True)
        _TOOL_EMBEDDINGS = {}
    return _TOOL_EMBEDDINGS


async def route_transcript(
    transcript: str,
    *,
    thread_message_count: int = 0,
) -> RouteDecision:
    """Decide how to handle a spoken/typed orb turn."""
    text = (transcript or "").strip()
    if not text:
        return RouteDecision(kind="ask_briefly", reason="empty")

    matched = regex_matches(text)

    # Active voice thread — route follow-ups through ask_briefly unless an explicit
    # command regex matches (e.g. "read my brief", "what's on my calendar").
    if thread_message_count > 0:
        if len(matched) == 1:
            return RouteDecision(
                kind="direct",
                tools=(matched[0],),
                confidence=1.0,
                reason="regex_single_in_thread",
            )
        return RouteDecision(
            kind="ask_briefly",
            confidence=1.0,
            reason="active_thread",
        )

    if len(matched) == 1:
        return RouteDecision(kind="direct", tools=(matched[0],), confidence=1.0, reason="regex_single")
    if len(matched) >= 2:
        return RouteDecision(kind="agent", tools=tuple(matched), confidence=1.0, reason="regex_multi")

    settings = get_settings()
    tool_vecs = await _ensure_tool_embeddings()
    if not tool_vecs:
        return RouteDecision(kind="ask_briefly", reason="no_embeddings")

    from briefly_api.embeddings.adapter import get_embedding_adapter

    try:
        q_vec = await get_embedding_adapter().embed(text)
    except Exception:
        return RouteDecision(kind="ask_briefly", reason="embed_failed")

    scored: list[tuple[float, OrbTool]] = []
    for tool in DATA_TOOLS:
        vec = tool_vecs.get(tool.name)
        if not vec:
            continue
        scored.append((_cosine(q_vec, vec), tool))
    scored.sort(key=lambda x: x[0], reverse=True)
    if not scored:
        return RouteDecision(kind="ask_briefly", reason="no_scores")

    top_score, top_tool = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0.0
    high = settings.orb_semantic_route_threshold
    medium = settings.orb_semantic_route_medium_threshold

    if top_score >= high and (top_score - second_score) >= 0.05:
        return RouteDecision(
            kind="direct",
            tools=(top_tool,),
            confidence=top_score,
            reason="semantic_single",
        )
    if top_score >= medium:
        multi = [t for s, t in scored if s >= medium][:3]
        return RouteDecision(
            kind="agent",
            tools=tuple(multi),
            confidence=top_score,
            reason="semantic_multi",
        )
    return RouteDecision(kind="ask_briefly", confidence=top_score, reason="semantic_low")
