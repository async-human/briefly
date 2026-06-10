"""Tests for profile intelligence topic matching."""
from __future__ import annotations

from briefly_api.services.topic_matching import topic_keywords as _topic_keywords


def test_topic_keywords_includes_short_terms():
    assert "ai" in _topic_keywords("ai tools")
    assert "tools" in _topic_keywords("ai tools")


def test_topic_keywords_handles_hyphenated_phrase():
    words = _topic_keywords("product-market fit")
    assert "product" in words
    assert "market" in words
    assert "fit" in words
