"""Expand Medium digest emails into individual scraped articles."""
from __future__ import annotations

import logging

from briefly_api.services.articles import NormalizedContent
from briefly_api.services.medium_extractor import extract_article_urls
from briefly_api.services.url_scraper import UrlFetchError, scrape_url

log = logging.getLogger(__name__)


async def fetch_medium_articles(urls: list[str]) -> list[NormalizedContent]:
    """Fetch full text for each Medium article URL, skipping failures silently."""
    articles: list[NormalizedContent] = []
    for url in urls:
        try:
            fetched = await scrape_url(url)
            for article in fetched:
                article.source_type = "url"
                article.section = "Articles"
            articles.extend(fetched)
        except UrlFetchError as exc:
            log.debug("medium: could not fetch %s — %s", url, exc)
        except Exception as exc:  # noqa: BLE001
            log.warning("medium: unexpected error fetching %s — %s", url, exc)
    return articles


async def expand_medium_digest_items(
    items: list[NormalizedContent],
    *,
    source_name: str | None = None,
    per_digest_limit: int = 6,
) -> list[NormalizedContent]:
    """
    Replace Medium digest emails with individual article items.
    Non-Medium items pass through unchanged.
    """
    results: list[NormalizedContent] = []
    for item in items:
        if not item.meta.get("is_medium_digest"):
            results.append(item)
            continue

        article_urls = extract_article_urls(item.meta.get("raw_html", ""))[:per_digest_limit]
        if not article_urls:
            results.append(item)
            continue

        fetched = await fetch_medium_articles(article_urls)
        if not fetched:
            results.append(item)
            continue

        label = source_name or item.source_name or "Medium"
        for article in fetched:
            article.source_name = label
        results.extend(fetched)
        log.info(
            "medium: expanded digest '%s' into %d articles for %s",
            item.title,
            len(fetched),
            label,
        )

    return results
