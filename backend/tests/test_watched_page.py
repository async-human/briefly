"""Tests for the universal watched-page connector's link harvesting."""
from __future__ import annotations

from briefly_api.services.connectors.registry import get_connector
from briefly_api.services.connectors.types import (
    ALL_SOURCE_TYPES,
    FETCHABLE_SOURCE_TYPES,
    WATCHED_PAGE,
)
from briefly_api.services.url_scraper import _extract_links_sync, _looks_like_article_path


def test_watched_page_registered_and_fetchable():
    assert WATCHED_PAGE in ALL_SOURCE_TYPES
    assert WATCHED_PAGE in FETCHABLE_SOURCE_TYPES
    assert get_connector(WATCHED_PAGE) is not None


def test_watched_page_not_auto_detected():
    # Single article URLs should stay `url`, not get hijacked into a watcher.
    assert get_connector(WATCHED_PAGE).can_handle("https://example.com/post") is False


def test_article_path_heuristic():
    assert _looks_like_article_path("/2026/06/some-long-post-slug") is True
    assert _looks_like_article_path("/blog/another-readable-headline") is True
    assert _looks_like_article_path("/tag/ai") is False
    assert _looks_like_article_path("/about") is False
    assert _looks_like_article_path("/") is False


def test_link_harvest_filters_nav_and_offsite():
    html = """
    <a href="/2026/06/my-great-post-title">post</a>
    <a href="/blog/another-long-slug-here">post2</a>
    <a href="/tag/foo">tag</a>
    <a href="/about">about</a>
    <a href="/feed">feed</a>
    <a href="https://other.com/2026/offsite-post-here">offsite</a>
    <a href="/cover.jpg">image</a>
    """
    links = _extract_links_sync("https://example.com/blog", html)
    assert "https://example.com/2026/06/my-great-post-title" in links
    assert "https://example.com/blog/another-long-slug-here" in links
    # Nav, tags, feeds, images and other hosts are excluded.
    assert all("other.com" not in u for u in links)
    assert all("/tag/" not in u for u in links)
    assert all("/about" not in u for u in links)
    assert all(".jpg" not in u for u in links)


def test_link_harvest_excludes_self():
    html = '<a href="/blog">self</a><a href="/blog/real-article-slug-here">a</a>'
    links = _extract_links_sync("https://example.com/blog", html)
    assert "https://example.com/blog" not in links
