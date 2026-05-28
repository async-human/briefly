from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

import feedparser


@dataclass
class FetchedArticle:
    title: str
    summary: str
    url: str | None
    source_name: str


def _strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def _fetch_rss_sync(url: str, limit: int = 5) -> list[FetchedArticle]:
    feed = feedparser.parse(url)
    source_name = feed.feed.get("title") or url
    articles: list[FetchedArticle] = []

    for entry in feed.entries[:limit]:
        raw_summary = entry.get("summary") or entry.get("description") or ""
        summary = _strip_html(raw_summary)[:400]
        articles.append(
            FetchedArticle(
                title=(entry.get("title") or "Untitled").strip(),
                summary=summary or "No summary available.",
                url=entry.get("link"),
                source_name=source_name,
            )
        )
    return articles


async def fetch_rss_articles(url: str, limit: int = 5) -> list[FetchedArticle]:
    return await asyncio.to_thread(_fetch_rss_sync, url, limit)
