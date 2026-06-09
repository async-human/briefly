"""Relevance rescue pass keeps a thin pool from going empty."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from briefly_api.agents.context import PipelineContext, RawItem, UserContext
from briefly_api.agents import relevance as relevance_mod


def _ctx(items: list[RawItem]) -> PipelineContext:
    user = UserContext(
        user_id="u1",
        email="u@test.com",
        name="Test",
        profile={
            "interests": [{"topic": "AI"}],
            "goal": "Build products",
            "profile_embedding": [0.1] * 8,
        },
        recent_digest_items=[],
        seen_content_hashes=set(),
        active_story_threads=[],
        topic_clusters=[],
    )
    ctx = PipelineContext(user=user, run_date="2026-06-02")
    ctx.deduplicated_items = items
    return ctx


def _item(title: str, score: float) -> RawItem:
    return RawItem(
        id=f"id-{title}",
        source_id="s1",
        source_type="rss",
        source_name="Feed",
        title=title,
        url="https://example.com",
        author=None,
        published_at=None,
        clean_text="body",
        content_hash=title,
        summary="summary",
        relevance_score=score,
        embedding=[0.1] * 8,
    )


def test_relevance_rescue_keeps_top_items_when_all_below_threshold():
    items = [
        _item("low-a", 0.41),
        _item("low-b", 0.44),
        _item("low-c", 0.39),
    ]
    ctx = _ctx(items)

    async def fake_semantic(*_args, **_kwargs):
        return 0.35

    async def run():
        with patch.object(relevance_mod, "_semantic_score", side_effect=fake_semantic):
            with patch.object(relevance_mod, "get_embedding_adapter") as mock_embed:
                mock_embed.return_value.embed_batch = AsyncMock(return_value=[[0.1] * 8] * 3)
                return await relevance_mod.run(ctx)

    result = asyncio.run(run())
    assert len(result.scored_items) >= 3
    assert result.scored_items[0].relevance_score >= result.scored_items[-1].relevance_score
