"""Tests for knowledge graph assembly helpers."""
from __future__ import annotations

from briefly_api.services.knowledge_graph import _cosine, _slug, _topic_match_score


def test_slug_normalizes_labels():
    assert _slug("Agentic AI") == "agentic-ai"


def test_topic_match_score_finds_keywords():
    score = _topic_match_score("Google released a new agentic AI model", "agentic AI")
    assert score >= 0.5


def test_cosine_identical_vectors():
    vec = [1.0, 0.0, 0.0]
    assert _cosine(vec, vec) == 1.0
