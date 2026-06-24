"""Tests for corpus library query detection and routing."""
from __future__ import annotations

import asyncio

from briefly_api.services.corpus_queries import (
    extract_topic_terms,
    is_corpus_library_query,
    is_saved_queue_only_query,
)
from briefly_api.services.orb_intent import classify_orb_intent


def test_corpus_library_query_articles_we_have():
    q = "what are the most interesting articles we have for ai?"
    assert is_corpus_library_query(q)
    assert "ai" in extract_topic_terms(q)


def test_saved_queue_only_not_corpus():
    q = "what is in my saved queue?"
    assert is_saved_queue_only_query(q)
    assert not is_corpus_library_query(q)


def test_corpus_routes_to_ask_briefly():
    decision = asyncio.run(
        classify_orb_intent(
            "what articles do I have about startups?",
            thread_message_count=0,
        )
    )
    assert decision.kind == "ask_briefly"
    assert decision.reason == "corpus_library"


def test_saved_articles_about_topic_is_corpus_not_queue():
    q = "my saved articles about machine learning"
    assert is_corpus_library_query(q)
    assert not is_saved_queue_only_query(q)
