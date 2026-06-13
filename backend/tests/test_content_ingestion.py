"""Tests for content ingestion deduplication."""
from __future__ import annotations

from briefly_api.services.content_ingestion import _content_hash, _legacy_content_hash


def test_content_hash_includes_url_to_avoid_medium_snippet_collisions():
    snippet = "Introduction Continue reading on Medium »"
    url_a = "https://medium.com/@author/a"
    url_b = "https://medium.com/@author/b"
    assert _content_hash(snippet, url_a) != _content_hash(snippet, url_b)


def test_content_hash_without_url_matches_legacy():
    text = "Some article body text here"
    assert _content_hash(text, None) == _legacy_content_hash(text)


def test_content_hash_same_url_and_text_is_stable():
    text = "Hello world"
    url = "https://example.com/post"
    assert _content_hash(text, url) == _content_hash(text, url)
