from __future__ import annotations

import asyncio
import re

import feedparser

from briefly_api.services.articles import FetchedArticle


def _strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def _fetch_rss_sync(url: str, limit: int = 5, source_name: str | None = None) -> list[FetchedArticle]:
    feed = feedparser.parse(url)
    name = source_name or feed.feed.get("title") or url
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
