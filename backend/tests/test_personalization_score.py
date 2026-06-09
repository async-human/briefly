"""Tests for unified personalization ranking."""
from __future__ import annotations

from briefly_api.agents.context import DigestItemDraft, RawItem
from briefly_api.services.digest_sections import SECTION_HIGHLY_RELEVANT
from briefly_api.services.personalization_score import (
    build_interest_model,
    pick_top_priority_content_ids,
    personalization_rank_score,
    topic_alignment_score,
)


def _item(
    item_id: str,
    *,
    title: str,
    relevance: float,
    source_id: str = "s1",
    section: str | None = None,
) -> RawItem:
    item = RawItem(
        id=item_id,
        source_id=source_id,
        source_type="rss",
        source_name="Tech",
        title=title,
        url="https://example.com/a",
        author=None,
        published_at=None,
        clean_text="body text about startups and product strategy",
        content_hash=item_id,
        summary="summary",
        relevance_score=relevance,
        novelty_score=0.9,
    )
    if section:
        item.meta["digest_section"] = section
    return item


def test_topic_alignment_prefers_goal_and_interests():
    model = build_interest_model(
        {
            "role": "Product manager",
            "goal": "Build an AI-native workflow product",
            "interests": [{"topic": "agentic AI"}],
        },
        [{"cluster": "LLM infrastructure", "strength": 0.8}],
    )
    aligned = _item("a", title="Agentic AI changes product workflows", relevance=0.7)
    generic = _item("b", title="Celebrity fashion week recap", relevance=0.7)

    assert topic_alignment_score(aligned, model) > topic_alignment_score(generic, model)


def test_personalization_rank_prefers_highly_relevant_section():
    model = build_interest_model({"goal": "Ship faster", "interests": []}, [])
    priority_map = {"s1": "normal"}
    fresh = _item("a", title="Shipping velocity", relevance=0.72)
    fresh.meta["digest_pool"] = "fresh"
    fresh.meta["digest_section"] = "What's new"
    relevant = _item("b", title="Shipping velocity", relevance=0.72)
    relevant.meta["digest_pool"] = "relevant"
    relevant.meta["digest_section"] = SECTION_HIGHLY_RELEVANT

    assert personalization_rank_score(
        relevant, priority_map=priority_map, interest_model=model
    ) > personalization_rank_score(
        fresh, priority_map=priority_map, interest_model=model
    )


def test_pick_top_priority_content_ids_uses_relevance_not_digest_order():
    enriched = [
        _item("c-low", title="Low fit story", relevance=0.62, source_id="s2"),
        _item("c-high", title="Agentic AI for PMs", relevance=0.91, source_id="s1"),
        _item("c-mid", title="Startup fundraising", relevance=0.78, source_id="s3"),
    ]
    drafts = [
        DigestItemDraft(
            content_id="c-low",
            position=1,
            section="What's new",
            headline="Low",
            summary="s",
            why_it_matters="w",
            source_name="Src",
            source_url="https://example.com",
            relevance_score=0.62,
        ),
        DigestItemDraft(
            content_id="c-high",
            position=2,
            section=SECTION_HIGHLY_RELEVANT,
            headline="High",
            summary="s",
            why_it_matters="w",
            source_name="Src",
            source_url="https://example.com",
            relevance_score=0.91,
        ),
        DigestItemDraft(
            content_id="c-mid",
            position=3,
            section=SECTION_HIGHLY_RELEVANT,
            headline="Mid",
            summary="s",
            why_it_matters="w",
            source_name="Src",
            source_url="https://example.com",
            relevance_score=0.78,
        ),
    ]
    profile = {
        "goal": "Build an AI product",
        "interests": [{"topic": "agentic AI"}],
        "role": "Founder",
    }

    top_ids = pick_top_priority_content_ids(
        drafts,
        enriched_items=enriched,
        profile=profile,
        topic_clusters=[],
        sources=[],
        memory_connections={},
    )

    assert top_ids[0] == "c-high"
    assert "c-low" not in top_ids[:2]
