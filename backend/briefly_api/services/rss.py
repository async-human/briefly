from __future__ import annotations

import asyncio
import logging
import re

import feedparser
import httpx

from briefly_api.services.articles import FetchedArticle

log = logging.getLogger(__name__)

_FEED_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_FEED_HEADERS = {
    "User-Agent": _FEED_UA,
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


def _strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def _load_feed_sync(url: str) -> tuple[feedparser.FeedParserDict, str, int | None]:
    """
    Fetch and parse a feed with redirect following and a browser User-Agent.
    Many publishers block feedparser's default client or return 404 on stale paths.
    """
    normalized = url.strip()
    try:
        with httpx.Client(timeout=20.0, follow_redirects=True, headers=_FEED_HEADERS) as client:
            resp = client.get(normalized)
            final_url = str(resp.url)
            if resp.status_code >= 400:
                log.warning("RSS feed returned HTTP %d for %s", resp.status_code, normalized)
                return feedparser.parse(b""), final_url, resp.status_code
            return feedparser.parse(resp.content), final_url, resp.status_code
    except httpx.RequestError as exc:
        log.debug("HTTP feed fetch failed for %s: %s — falling back to feedparser", normalized, exc)

    feed = feedparser.parse(normalized)
    return feed, getattr(feed, "href", normalized) or normalized, getattr(feed, "status", None)


def feed_has_entries(url: str) -> bool:
    """Return True if the URL resolves to a feed with at least one entry."""
    feed, _, status = _load_feed_sync(url)
    if status is not None and status >= 400:
        return False
    return len(feed.entries) > 0


def _fetch_rss_sync(url: str, limit: int = 5, source_name: str | None = None) -> list[FetchedArticle]:
    feed, final_url, status = _load_feed_sync(url)

    if status is not None and status >= 400:
        raise ValueError(f"Feed returned HTTP {status}: {url}")

    if getattr(feed, "bozo", False) and not feed.entries:
        exc = getattr(feed, "bozo_exception", None)
        log.debug("RSS feed bozo error for %s: %s", final_url, exc)

    name = source_name or feed.feed.get("title") or final_url
    articles: list[FetchedArticle] = []

    for entry in feed.entries[:limit]:
        raw_summary = entry.get("summary") or entry.get("description") or ""
        summary = _strip_html(raw_summary)[:400]
        articles.append(
            FetchedArticle(
                title=(entry.get("title") or "Untitled").strip(),
                summary=summary or "No summary available.",
                url=entry.get("link"),
                source_name=name,
                source_type="rss",
                section="News & feeds",
            )
        )
    return articles


async def fetch_rss_articles(
    url: str,
    limit: int = 5,
    source_name: str | None = None,
) -> list[FetchedArticle]:
    return await asyncio.to_thread(_fetch_rss_sync, url, limit, source_name)
