from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.gmail import get_gmail_connection, refresh_gmail_access_token
from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import GMAIL
from briefly_api.services.gmail import fetch_newsletters
from briefly_api.services.medium_extractor import extract_article_urls
from briefly_api.services.url_scraper import UrlFetchError, scrape_url

log = logging.getLogger(__name__)


class GmailConnector(BaseConnector):
    source_type = GMAIL
    label = "Gmail newsletters"
    detect_hint = "We'll read newsletter emails from your inbox automatically."

    def normalize_identifier(self, identifier: str) -> str:
        return identifier.strip().lower()

    def can_handle(self, identifier: str) -> bool:
        return False  # Gmail is connected via OAuth, not pasted input

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 8,
        source_name: str | None = None,
        meta: dict | None = None,
        db: AsyncSession | None = None,
    ) -> list[NormalizedContent]:
        if not db or not meta or not meta.get("user_id"):
            raise ValueError("Gmail source requires an authenticated user connection.")

        connection = await get_gmail_connection(db, meta["user_id"])
        if not connection:
            raise ValueError("Gmail is not connected. Connect Gmail in onboarding or settings.")

        access_token = await refresh_gmail_access_token(connection, settings)
        await db.commit()
        raw_items = await fetch_newsletters(access_token, limit=limit)

        results: list[NormalizedContent] = []
        for item in raw_items:
            if source_name:
                item.source_name = source_name

            if item.meta.get("is_medium_digest"):
                # Expand the digest email into individual fetched articles
                article_urls = extract_article_urls(item.meta.get("raw_html", ""))
                fetched = await _fetch_medium_articles(article_urls)
                if fetched:
                    results.extend(fetched)
                    log.info(
                        "medium: expanded digest '%s' into %d articles",
                        item.title,
                        len(fetched),
                    )
                # Don't include the raw digest email body in the pipeline
                continue

            results.append(item)

        return results

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        return ConnectorValidation(valid=True)


async def _fetch_medium_articles(urls: list[str]) -> list[NormalizedContent]:
    """Fetch full text for each Medium article URL, skipping failures silently."""
    articles: list[NormalizedContent] = []
    for url in urls:
        try:
            fetched = await scrape_url(url)
            for article in fetched:
                # Re-label so the pipeline knows these came from Medium
                article.source_type = "url"
                article.source_name = "Medium"
                article.section = "Articles"
            articles.extend(fetched)
        except UrlFetchError as exc:
            log.debug("medium: could not fetch %s — %s", url, exc)
        except Exception as exc:  # noqa: BLE001
            log.warning("medium: unexpected error fetching %s — %s", url, exc)
    return articles
