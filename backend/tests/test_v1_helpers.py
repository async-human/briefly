"""Unit tests for V1/V1.5 pipeline helpers."""
from __future__ import annotations

from briefly_api.agents.briefing_writer import (
    _ensure_personalized_why,
    _why_is_personalized,
    build_fallback_drafts,
)
from briefly_api.agents.context import DigestItemDraft, PipelineContext, RawItem, UserContext
from briefly_api.services.profile_utils import cluster_label, iter_topic_clusters


def test_cluster_label_skips_meta_rows():
    assert cluster_label({"_type": "source_weight", "weights": {"hn": 0.9}}) is None
    assert cluster_label({"cluster": "AI & Models"}) == "AI & Models"
    assert cluster_label({"topic": "startups"}) == "startups"


def test_iter_topic_clusters_filters_meta():
    rows = [
        {"_type": "source_weight", "weights": {}},
        {"cluster": "Engineering", "item_count": 2},
    ]
    assert len(list(iter_topic_clusters(rows))) == 1


def test_build_fallback_drafts_from_selected_ids():
    item = RawItem(
        id="item-1",
        source_id="src-1",
        source_type="rss",
        source_name="TechCrunch",
        title="Test headline",
        url="https://example.com/a",
        author=None,
        published_at=None,
        clean_text="Body text here",
        content_hash="abc",
        summary="Summary",
        relevance_score=0.8,
    )
    user = UserContext(
        user_id="u1",
        email="u@test.com",
        name="Test",
        profile={"role": "Founder", "interests": [{"topic": "AI"}]},
        recent_digest_items=[],
        seen_content_hashes=set(),
        active_story_threads=[],
        topic_clusters=[],
    )
    ctx = PipelineContext(user=user, run_date="2026-05-28")
    ctx.enriched_items = [item]
    ctx.selected_item_ids = ["item-1"]

    drafts = build_fallback_drafts(ctx)
    assert len(drafts) == 1
    assert drafts[0].headline == "Test headline"
    assert drafts[0].section


def test_build_fallback_drafts_when_writer_would_return_empty():
    user = UserContext(
        user_id="u1",
        email="u@test.com",
        name="Test",
        profile={"role": "Founder", "interests": [{"topic": "AI"}]},
        recent_digest_items=[],
        seen_content_hashes=set(),
        active_story_threads=[],
        topic_clusters=[],
    )
    ctx = PipelineContext(user=user, run_date="2026-05-28")
    ctx.enriched_items = []
    ctx.selected_item_ids = []

    drafts = build_fallback_drafts(ctx)
    assert drafts == []


def test_why_personalization_validator():
    profile = {"role": "Founder", "goal": "building AI products", "interests": [{"topic": "AI agents"}]}
    assert not _why_is_personalized("Worth a read based on what you follow.", profile)
    assert _why_is_personalized(
        "As a founder building AI products, this directly affects your roadmap.",
        profile,
    )


def test_ensure_personalized_why_rewrites_generic():
    profile = {"role": "Engineer", "interests": [{"topic": "LLMs"}]}
    item = RawItem(
        id="x",
        source_id="s",
        source_type="rss",
        source_name="HN",
        title="T",
        url=None,
        author=None,
        published_at=None,
        clean_text="c",
        content_hash="h",
    )
    drafts = [
        DigestItemDraft(
            content_id="x",
            position=1,
            section="What's new",
            headline="T",
            summary="S",
            why_it_matters="Worth a read based on what you follow.",
            source_name="HN",
            source_url=None,
        )
    ]
    fixed = _ensure_personalized_why(drafts, [item], profile)
    assert "engineer" in fixed[0].why_it_matters.lower() or "llm" in fixed[0].why_it_matters.lower()


def test_hindi_why_is_personalized_with_devanagari():
    profile = {"brief_language": "hi", "role": "founder", "interests": []}
    hindi = "यह आपकी रुचि के स्टार्टअप फंडिंग से जुड़ा है — आज पढ़ने लायक।"
    assert _why_is_personalized(hindi, profile) is True


def test_ensure_personalized_why_skips_english_fallback_for_hindi():
    profile = {"brief_language": "hi", "role": "founder", "interests": []}
    item = RawItem(
        id="x",
        source_id="s",
        source_type="rss",
        source_name="HN",
        title="T",
        url=None,
        author=None,
        published_at=None,
        clean_text="c",
        content_hash="h",
    )
    hindi_why = "यह आपके AI टूल्स के रुचि से मेल खाता है।"
    drafts = [
        DigestItemDraft(
            content_id="x",
            position=1,
            section="What's new",
            headline="T",
            summary="S",
            why_it_matters=hindi_why,
            source_name="HN",
            source_url=None,
        )
    ]
    fixed = _ensure_personalized_why(drafts, [item], profile)
    assert fixed[0].why_it_matters == hindi_why
