from __future__ import annotations

import logging

from briefly_api.config import Settings
from briefly_api.db.models import Source, SourceType
from briefly_api.services.articles import FetchedArticle
from briefly_api.services.reddit import fetch_reddit_posts
from briefly_api.services.rss import fetch_rss_articles
from briefly_api.services.youtube import fetch_youtube_articles

log = logging.getLogger(__name__)

_FETCHABLE = {SourceType.rss, SourceType.youtube, SourceType.reddit}


async def collect_from_sources(
    sources: list[Source],
    settings: Settings,
    *,
    max_items: int = 8,
) -> tuple[list[FetchedArticle], list[str]]:
    """Fetch articles from all supported sources. Returns (articles, warnings)."""
    active = [s for s in sources if s.source_type in _FETCHABLE]
    if not active:
        return [], []

    per_source = max(2, max_items // len(active))
    articles: list[FetchedArticle] = []
    warnings: list[str] = []

    for source in active:
        display_name = source.name
        try:
            if source.source_type == SourceType.rss:
                fetched = await fetch_rss_articles(
                    source.identifier, limit=per_source, source_name=display_name
                )
            elif source.source_type == SourceType.youtube:
                fetched = await fetch_youtube_articles(
                    source.identifier, limit=per_source, settings=settings, source_name=display_name
                )
            elif source.source_type == SourceType.reddit:
                fetched = await fetch_reddit_posts(
                    source.identifier, limit=per_source, settings=settings, source_name=display_name
                )
            else:
                continue

            for item in fetched:
                if display_name:
                    item.source_name = display_name
            articles.extend(fetched)
        except Exception as exc:
            log.exception("Failed to fetch source %s (%s)", source.identifier, source.source_type)
            label = display_name or source.identifier
            warnings.append(f"Could not fetch {label}: {exc}")

    email_sources = [s for s in sources if s.source_type == SourceType.email]
    if email_sources:
        warnings.append(
            f"{len(email_sources)} email source(s) skipped — forward newsletters to your ingestion address; "
            "they'll appear once email ingestion is processed."
        )

    return articles[:max_items], warnings
