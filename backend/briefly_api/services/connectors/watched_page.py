"""
WatchedPageConnector — continuous ingestion from *any* web page, even
without an RSS feed.

Point it at a blog index, a news section, a docs changelog, a portfolio —
anything that links to articles. Each run harvests the links on the page,
scrapes the ones it hasn't seen before, and emits them as content. Already
seen URLs are tracked in ``source.meta["seen_urls"]`` so the source learns
its own footprint over time and we don't re-scrape (or re-pay for) the same
articles every night.

This is the fallback that makes "follow this source" work universally:
RSS when available, watched-page when not.
"""
from __future__ import annotations

import logging
import re

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import WATCHED_PAGE
from briefly_api.services.url_scraper import (
    UrlFetchError,
    harvest_links,
    probe_url,
    scrape_many,
    scrape_url,
)

log = logging.getLogger(__name__)

# Keep the seen-URL ledger bounded so source.meta doesn't grow without limit.
_MAX_SEEN_URLS = 500


class WatchedPageConnector(BaseConnector):
    source_type = WATCHED_PAGE
    label = "Watched page"
    detect_hint = "We'll follow this page and pull in new articles it links to."

    def normalize_identifier(self, identifier: str) -> str:
        value = identifier.strip()
        if not value.startswith(("http://", "https://")):
            value = f"https://{value}"
        return value.rstrip("/")

    def can_handle(self, identifier: str) -> bool:
        # Never auto-detected — chosen explicitly so we don't surprise users
        # who paste a single article URL (that stays a one-shot `url` source).
        return False

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 8,
        source_name: str | None = None,
        meta: dict | None = None,
        db: object | None = None,
    ) -> list[NormalizedContent]:
        url = self.normalize_identifier(identifier)
        meta = meta or {}
        seen: set[str] = {u for u in (meta.get("seen_urls") or []) if u}

        try:
            links = await harvest_links(url, max_links=40)
        except UrlFetchError as exc:
            log.warning("WatchedPage: could not read index %s: %s", url, exc)
            links = []

        fresh = [u for u in links if u.rstrip("/") not in seen][: max(limit, 8)]

        articles: list[NormalizedContent] = []
        if fresh:
            articles = await scrape_many(fresh)

        # If the page has no harvestable links (single-article page, SPA, etc.)
        # fall back to scraping the page itself so the source is never silent.
        if not articles and url.rstrip("/") not in seen:
            try:
                articles = await scrape_url(url)
            except UrlFetchError:
                articles = []

        for item in articles:
            item.source_type = self.source_type
            if source_name:
                item.source_name = source_name

        await self._record_seen(db, meta, [a.url for a in articles if a.url] + fresh)
        return articles[:limit]

    async def _record_seen(
        self, db: object | None, meta: dict, new_urls: list[str]
    ) -> None:
        """Persist newly seen URLs onto the Source row when a session is available."""
        source_id = meta.get("source_id")
        if not isinstance(db, AsyncSession) or not source_id:
            return
        try:
            from sqlalchemy import select
            from sqlalchemy.orm.attributes import flag_modified

            from briefly_api.db.models import Source

            result = await db.execute(select(Source).where(Source.id == source_id))
            source = result.scalar_one_or_none()
            if not source:
                return
            ledger = list((source.meta or {}).get("seen_urls") or [])
            existing = set(ledger)
            for u in new_urls:
                key = u.rstrip("/")
                if key and key not in existing:
                    existing.add(key)
                    ledger.append(key)
            # Keep the most recent entries only.
            ledger = ledger[-_MAX_SEEN_URLS:]
            source.meta = {**(source.meta or {}), "seen_urls": ledger}
            flag_modified(source, "meta")
            await db.flush()
        except Exception:
            log.debug("WatchedPage: could not persist seen_urls", exc_info=True)

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        normalized = self.normalize_identifier(identifier)
        if not re.match(r"^https?://", normalized):
            return ConnectorValidation(valid=False, message="Enter a valid website URL.")
        try:
            await probe_url(normalized)
        except UrlFetchError as exc:
            return ConnectorValidation(valid=False, message=str(exc))
        return ConnectorValidation(valid=True)
