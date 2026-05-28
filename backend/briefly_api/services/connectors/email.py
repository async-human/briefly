from __future__ import annotations

import re

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import EMAIL
from briefly_api.services.rss import fetch_rss_articles


class EmailConnector(BaseConnector):
    source_type = EMAIL
    label = "Email newsletter"
    detect_hint = "Forward mail to your ingestion address — we'll include it in briefings."

    def normalize_identifier(self, identifier: str) -> str:
        return identifier.strip().lower()

    def can_handle(self, identifier: str) -> bool:
        value = identifier.strip()
        return "@" in value and not value.lower().startswith(("http://", "https://"))

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 8,
        source_name: str | None = None,
        meta: dict | None = None,
    ) -> list[NormalizedContent]:
        return []

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        normalized = self.normalize_identifier(identifier)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            return ConnectorValidation(valid=False, message="Enter a valid email address.")
        return ConnectorValidation(valid=True, suggested_name=normalized)
