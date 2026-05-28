from __future__ import annotations

import asyncio
import re

import feedparser

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import RSS
from briefly_api.services.rss import fetch_rss_articles


def _looks_like_feed_url(value: str) -> bool:
    lower = value.lower()
    return any(token in lower for token in ("/feed", "/rss", ".xml", "feeds.", "atom"))


def _probe_rss_sync(url: str) -> bool:
    feed = feedparser.parse(url)
    return len(feed.entries) > 0


class RssConnector(BaseConnector):
    source_type = RSS
    label = "RSS feed"
    detect_hint = "We'll check this feed for new posts."

    def normalize_identifier(self, identifier: str) -> str:
        return identifier.strip().rstrip("/")

    def can_handle(self, identifier: str) -> bool:
        value = identifier.strip().lower()
        if not value.startswith(("http://", "https://")):
            return False
        if _looks_like_feed_url(value):
            return True
        return _probe_rss_sync(value)

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 8,
        source_name: str | None = None,
        meta: dict | None = None,
    ) -> list[NormalizedContent]:
        return await fetch_rss_articles(
            self.normalize_identifier(identifier),
            limit=limit,
            source_name=source_name,
        )

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        normalized = self.normalize_identifier(identifier)
        ok = await asyncio.to_thread(_probe_rss_sync, normalized)
        if not ok:
            return ConnectorValidation(valid=False, message="Not a valid RSS or Atom feed.")
        return ConnectorValidation(valid=True)
