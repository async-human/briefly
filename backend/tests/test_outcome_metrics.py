"""Tests for outcome-native briefing metadata."""
from __future__ import annotations

from briefly_api.agents.context import DigestItemDraft, PipelineContext, RawItem, UserContext  # noqa: F401
from briefly_api.services.outcome_metrics import build_outcome_meta


def _ctx(**kwargs) -> PipelineContext:
    user = UserContext(
        user_id="u1",
        email="u@test.com",
        name="Test",
        profile={"interests": ["AI", "startups"], "goal": "Build an AI product"},
        recent_digest_items=[],
        seen_content_hashes=set(),
        active_story_threads=[],
        topic_clusters=[],
    )
    ctx = PipelineContext(user=user, run_date="2026-06-02")
    ctx.total_ingested = kwargs.get("total_ingested", 40)
    ctx.total_shown = kwargs.get("total_shown", 8)
    if "raw_items" in kwargs:
        ctx.raw_items = kwargs["raw_items"]
    else:
        ctx.raw_items = [
            RawItem(
                id=f"c{i}",
                source_id="s1",
                source_type="rss",
                source_name="Src",
                title=f"T{i}",
                url="https://example.com",
                author=None,
                published_at=None,
                clean_text="word " * 200,
                content_hash=f"h{i}",
            )
            for i in range(40)
        ]
    ctx.digest_items = kwargs.get(
        "digest_items",
        [
            DigestItemDraft(
                content_id="c1",
                position=1,
                section="Highly relevant to you",
                headline="A",
                summary="s",
                why_it_matters="w",
                source_name="Src",
                source_url="https://example.com",
                relevance_score=0.9,
            ),
            DigestItemDraft(
                content_id="c2",
                position=2,
                section="What's new",
                headline="B",
                summary="s",
                why_it_matters="w",
                source_name="Src",
                source_url="https://example.com",
                relevance_score=0.7,
            ),
        ],
    )
    ctx.dropped_items = kwargs.get("dropped_items", [])
    ctx.crowded_out_items = kwargs.get("crowded_out_items", [])
    return ctx


def test_build_outcome_meta_saved_minutes_and_top3():
    ctx = _ctx()
    outcome = build_outcome_meta(ctx)

    assert outcome["saved_minutes"] >= 1
    assert outcome["filtered_count"] >= 32
    assert outcome.get("words_scanned", 0) > 0
    assert outcome["top_priority_content_ids"] == ["c1", "c2"]
    assert outcome["catch_up_topics"] == ["AI", "startups"]
    assert "filtered" in outcome["skipped_note"].lower()


def test_build_outcome_meta_uses_writer_skipped_note():
    ctx = _ctx()
    ctx.__dict__["skipped_note"] = "Skipped 12 crypto price updates."
    outcome = build_outcome_meta(ctx)
    assert outcome["skipped_note"] == "Skipped 12 crypto price updates."
