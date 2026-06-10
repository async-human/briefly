"""Tests for topic ↔ article matching."""
from __future__ import annotations

from briefly_api.services.topic_matching import (
    item_matches_topic,
    topic_keywords,
    topic_match_text,
    topic_matches,
)


def test_topic_keywords_excludes_stop_words():
    words = topic_keywords("bill of materials")
    assert "of" not in words
    assert "bill" in words
    assert "materials" in words


def test_topic_keywords_includes_short_terms():
    assert "ai" in topic_keywords("ai tools")
    assert "tools" in topic_keywords("ai tools")


def test_bill_of_materials_requires_both_significant_words():
    text = topic_match_text("Congress passes a new spending bill", None)
    assert not topic_matches(text, "bill of materials")

    text = topic_match_text("EV makers rethink bill of materials costs", None)
    assert topic_matches(text, "bill of materials")


def test_headline_only_does_not_false_match_via_interest_copy():
    """Headlines without the topic should not match (why_it_matters is excluded upstream)."""
    headline = "Exploring the dangers of releasing GPT-2"
    text = topic_match_text(headline, None)
    assert not topic_matches(text, "bill of materials")
    assert not topic_matches(text, "startup funding")


def test_loose_of_does_not_match_everything():
    text = topic_match_text("A story of growth and change", None)
    assert not topic_matches(text, "bill of materials")


def test_ai_tools_needs_both_words():
    assert topic_matches(topic_match_text("Best AI tools for founders", None), "ai tools")
    assert not topic_matches(topic_match_text("Congress passes a new bill", None), "ai tools")


def test_hyphenated_topic_splits_tokens():
    words = topic_keywords("ai-ml engineer")
    assert "ai" in words
    assert "ml" in words
    assert "engineer" in words


def test_llms_alias_matches_llm_in_headline():
    assert topic_matches(topic_match_text("How LLM routing changes inference", None), "llms")


def test_confidence_signal_can_attribute_topic():
    assert item_matches_topic(
        "Weekly roundup",
        "Various links",
        "Hacker News",
        "Matches your generative ai cluster",
        "generative ai",
    )
