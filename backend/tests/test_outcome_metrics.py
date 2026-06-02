"""Tests for outcome-native briefing metadata."""
from __future__ import annotations

from briefly_api.agents.context import DigestItemDraft, PipelineContext, RawItem, UserContext
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

    assert outcome["saved_minutes"] >= 5
    assert outcome["filtered_count"] >= 32
    assert outcome["top_priority_content_ids"] == ["c1", "c2"]
    assert outcome["catch_up_topics"] == ["AI", "startups"]
    assert "filtered" in outcome["skipped_note"].lower()


def test_build_outcome_meta_uses_writer_skipped_note():
    ctx = _ctx()
    ctx.__dict__["skipped_note"] = "Skipped 12 crypto price updates."
    outcome = build_outcome_meta(ctx)
    assert outcome["skipped_note"] == "Skipped 12 crypto price updates."
