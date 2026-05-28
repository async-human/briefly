from __future__ import annotations

import re

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import URL
from briefly_api.services.url_scraper import UrlFetchError, probe_url, scrape_url


class UrlConnector(BaseConnector):
    source_type = URL
    label = "Website"
    detect_hint = "We'll scrape readable articles from this page."

    def normalize_identifier(self, identifier: str) -> str:
        value = identifier.strip()
        if not value.startswith(("http://", "https://")):
            value = f"https://{value}"
        return value.rstrip("/")

    def can_handle(self, identifier: str) -> bool:
        value = identifier.strip().lower()
        return value.startswith(("http://", "https://")) or bool(
            re.fullmatch(r"[\w.-]+\.\w{2,}(/.*)?", value)
        )

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 8,
        source_name: str | None = None,
        meta: dict | None = None,
    ) -> list[NormalizedContent]:
        articles = await scrape_url(self.normalize_identifier(identifier))
        if source_name:
            for item in articles:
                item.source_name = source_name
        return articles[:limit]

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        normalized = self.normalize_identifier(identifier)
        if not normalized.startswith(("http://", "https://")):
            return ConnectorValidation(valid=False, message="Enter a valid website URL.")
        try:
            await probe_url(normalized)
        except UrlFetchError as exc:
            return ConnectorValidation(valid=False, message=str(exc))
        return ConnectorValidation(valid=True)
