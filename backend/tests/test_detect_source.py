"""Tests for URL source-type detection (RSS, article, watched page)."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from briefly_api.services.connectors.registry import detect_source
from briefly_api.services.connectors.types import URL, WATCHED_PAGE


def test_detect_homepage_defaults_to_watched_page():
    with patch(
        "briefly_api.services.connectors.registry.discover_rss_feed",
        new_callable=AsyncMock,
        return_value=None,
    ):
        detected = asyncio.run(detect_source("https://example.com/blog"))

    assert detected.source_type == WATCHED_PAGE
    assert detected.label == "Follow this site"
    assert len(detected.alternatives) == 1
    assert detected.alternatives[0].source_type == URL
    assert detected.alternatives[0].label == "Save once"


def test_detect_article_defaults_to_url():
    with patch(
        "briefly_api.services.connectors.registry.discover_rss_feed",
        new_callable=AsyncMock,
        return_value=None,
    ):
        detected = asyncio.run(detect_source("https://example.com/2026/06/some-long-post-slug"))

    assert detected.source_type == URL
    assert detected.label == "Save once"
    assert len(detected.alternatives) == 1
    assert detected.alternatives[0].source_type == WATCHED_PAGE
    assert detected.alternatives[0].label == "Follow this site"


def test_detect_rss_feed_when_discovered():
    with patch(
        "briefly_api.services.connectors.registry.discover_rss_feed",
        new_callable=AsyncMock,
        return_value="https://example.com/feed.xml",
    ):
        detected = asyncio.run(detect_source("https://example.com"))

    assert detected.source_type == "rss"
    assert detected.identifier == "https://example.com/feed.xml"
    assert detected.alternatives == []
