from __future__ import annotations

import re

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import REDDIT
from briefly_api.services.reddit import fetch_reddit_posts


def _extract_subreddit(value: str) -> str | None:
    value = value.strip()
    match = re.search(r"reddit\.com/r/([\w-]+)", value, re.IGNORECASE)
    if match:
        return match.group(1).lower()
    bare = value.removeprefix("r/").removeprefix("/r/").strip().lower()
    if re.fullmatch(r"[\w-]+", bare):
        return bare
    return None


class RedditConnector(BaseConnector):
    source_type = REDDIT
    label = "Subreddit"
    detect_hint = "We'll pull hot posts from this subreddit."

    def normalize_identifier(self, identifier: str) -> str:
        sub = _extract_subreddit(identifier)
        return sub or identifier.strip().lower()

    def can_handle(self, identifier: str) -> bool:
        value = identifier.strip()
        if "reddit.com" in value.lower():
            return _extract_subreddit(value) is not None
        bare = value.removeprefix("r/").strip()
        return bool(re.fullmatch(r"[\w-]+", bare)) and "@" not in bare and "." not in bare

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 8,
        source_name: str | None = None,
        meta: dict | None = None,
    ) -> list[NormalizedContent]:
        return await fetch_reddit_posts(
            self.normalize_identifier(identifier),
            limit=limit,
            settings=settings,
            source_name=source_name,
        )

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        sub = _extract_subreddit(identifier)
        if not sub:
            return ConnectorValidation(valid=False, message="Enter a subreddit name or reddit.com/r/… URL.")
        return ConnectorValidation(valid=True, suggested_name=f"r/{sub}")
