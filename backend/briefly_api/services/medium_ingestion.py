"""Expand Medium digest emails into individual articles for the briefing pipeline."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from briefly_api.services.articles import NormalizedContent
from briefly_api.services.medium_extractor import (
    detect_medium_digest,
    extract_article_previews,
    extract_article_urls,
)
from briefly_api.services.url_scraper import UrlFetchError, scrape_url

log = logging.getLogger(__name__)

_SCRAPE_TIMEOUT_SEC = 12.0
_MAX_PARALLEL_SCRAPES = 4


async def _scrape_one(url: str) -> list[NormalizedContent]:
    try:
        return await asyncio.wait_for(scrape_url(url), timeout=_SCRAPE_TIMEOUT_SEC)
    except (asyncio.TimeoutError, UrlFetchError) as exc:
        log.debug("medium: scrape skipped for %s — %s", url, exc)
        return []
    except Exception as exc:  # noqa: BLE001
        log.warning("medium: unexpected scrape error for %s — %s", url, exc)
        return []


async def fetch_medium_articles(urls: list[str]) -> list[NormalizedContent]:
    """Fetch full text for Medium URLs in parallel."""
    if not urls:
        return []

    sem = asyncio.Semaphore(_MAX_PARALLEL_SCRAPES)

    async def _one(url: str) -> list[NormalizedContent]:
        async with sem:
            fetched = await _scrape_one(url)
            for article in fetched:
                article.source_type = "url"
                article.section = "Articles"
            return fetched

    batches = await asyncio.gather(*[_one(u) for u in urls])
    return [item for batch in batches for item in batch]


def _fallback_items(
    previews: list[dict[str, str]],
    *,
    source_name: str,
    published_at: datetime | None,
) -> list[NormalizedContent]:
    """Use digest link + title when live scrape fails (Medium often blocks bots)."""
    items: list[NormalizedContent] = []
    for preview in previews:
        title = preview.get("title") or "Medium article"
        url = preview["url"]
        snippet = (
            f"{title}\n\nRecommended in your Medium digest. "
            f"Open the article for the full post."
        )
        items.append(
            NormalizedContent(
                title=title,
                url=url,
                source_name=source_name,
                source_type="url",
                section="Articles",
                author="Medium",
                published_at=published_at or datetime.now(timezone.utc),
                clean_text=snippet,
                summary=snippet[:400],
                meta={"from_medium_digest": True, "article_url": url},
            )
        )
    return items


async def expand_medium_digest_items(
    items: list[NormalizedContent],
    *,
    source_name: str | None = None,
    per_digest_limit: int = 8,
) -> list[NormalizedContent]:
    """
    Replace Medium digest emails with individual article items.
    Falls back to digest titles/URLs when scraping is blocked or slow.
    """
    results: list[NormalizedContent] = []
    for item in items:
        raw_html = item.meta.get("raw_html", "")
        author = item.author or item.meta.get("sender")
        is_digest = item.meta.get("is_medium_digest") or detect_medium_digest(raw_html, author)

        if not is_digest:
            results.append(item)
            continue

        previews = extract_article_previews(raw_html)[:per_digest_limit]
        if not previews:
            # Keep digest email body rather than dropping entirely
            log.info("medium: no article links in digest '%s' — keeping email body", item.title)
            results.append(item)
            continue

        urls = [p["url"] for p in previews]
        fetched = await fetch_medium_articles(urls)
        label = source_name or item.source_name or "Medium"

        if fetched:
            for article in fetched:
                article.source_name = label
                article.meta = {**article.meta, "from_medium_digest": True}
            results.extend(fetched)
            log.info(
                "medium: expanded digest '%s' into %d scraped articles for %s",
                item.title, len(fetched), label,
            )
            continue

        fallbacks = _fallback_items(
            previews,
            source_name=label,
            published_at=item.published_at,
        )
        results.extend(fallbacks)
        log.info(
            "medium: digest '%s' → %d fallback article(s) for %s (scrape blocked)",
            item.title, len(fallbacks), label,
        )

    return results
