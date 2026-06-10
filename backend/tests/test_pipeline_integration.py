"""Integration-style tests for pipeline helpers (mocked LLM path)."""
from __future__ import annotations

import asyncio

from briefly_api.agents.context import PipelineContext, RawItem, UserContext
from briefly_api.agents import planner, briefing_writer, serendipity
from briefly_api.services.digest_sections import SECTION_HIGHLY_RELEVANT, SECTION_WHATS_NEW


def _raw_item(iid: str, *, score: float, section: str = SECTION_WHATS_NEW) -> RawItem:
    item = RawItem(
        id=iid,
        source_id=f"src-{iid}",
        source_type="rss",
        source_name="Test Source",
        title=f"Story {iid}",
        url=f"https://example.com/{iid}",
        author=None,
        published_at=None,
        clean_text=f"Body text for {iid} " * 40,
        content_hash=f"hash-{iid}",
        relevance_score=score,
        novelty_score=0.8,
    )
    item.meta["digest_section"] = section
    return item


def _ctx_with_items(items: list[RawItem], *, is_pro: bool = True) -> PipelineContext:
    user = UserContext(
        user_id="u-test",
        email="test@example.com",
        name="Test",
        plan="pro" if is_pro else "free",
        is_pro=is_pro,
        profile={
            "role": "founder",
            "goal": "build AI product",
            "interests": [{"topic": "AI"}],
            "never_show": [],
        },
        recent_digest_items=[],
        seen_content_hashes=set(),
        active_story_threads=[],
        topic_clusters=[],
        sources=[],
    )
    ctx = PipelineContext(user=user, run_date="2026-06-10")
    ctx.enriched_items = items
    ctx.memory_connections = {}
    return ctx


def test_planner_produces_dual_pool_sections():
    items = [
        _raw_item("a", score=0.9, section=SECTION_HIGHLY_RELEVANT),
        _raw_item("b", score=0.85),
        _raw_item("c", score=0.75),
        _raw_item("d", score=0.7),
        _raw_item("e", score=0.65),
    ]
    ctx = _ctx_with_items(items)

    async def _run():
        return await planner.run(ctx)

    ctx = asyncio.run(_run())
    assert len(ctx.selected_item_ids) >= 3
    sections = {i.meta.get("digest_section") for i in ctx.enriched_items if i.id in ctx.selected_item_ids}
    assert SECTION_WHATS_NEW in sections or SECTION_HIGHLY_RELEVANT in sections


def test_planner_free_user_caps_items():
    items = [_raw_item(str(i), score=0.9 - i * 0.02) for i in range(12)]
    ctx = _ctx_with_items(items, is_pro=False)

    async def _run():
        return await planner.run(ctx)

    ctx = asyncio.run(_run())
    assert len(ctx.selected_item_ids) <= 5


def test_writer_fallback_drafts_non_empty():
    items = [_raw_item("x", score=0.88), _raw_item("y", score=0.82)]
    ctx = _ctx_with_items(items)
    ctx.selected_item_ids = [i.id for i in items]
    for item in items:
        item.meta["digest_section"] = SECTION_WHATS_NEW

    drafts = briefing_writer.build_fallback_drafts(ctx)
    assert len(drafts) == 2
    assert all(d.why_it_matters for d in drafts)


def test_serendipity_agent_runs_without_db():
    ctx = _ctx_with_items([_raw_item("z", score=0.9)])
    ctx.selected_item_ids = ["z"]
    ctx.enrichment_cache = {
        "z": {
            "connection_sentence": "Links to your EU AI regulation thread from last week.",
            "connection_strength": 0.75,
        }
    }

    async def _run():
        return await serendipity.run(ctx)

    ctx = asyncio.run(_run())
    assert len(ctx.serendipity_connections) >= 1
    conn = ctx.serendipity_connections[0]
    assert conn.get("kind") == "in_brief"
    assert conn.get("body")
