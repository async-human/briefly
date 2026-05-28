from __future__ import annotations

import re

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import YOUTUBE
from briefly_api.services.youtube import (
    _extract_channel_id,
    _extract_handle,
    fetch_youtube_articles,
)


def looks_like_youtube(identifier: str) -> bool:
    value = identifier.strip()
    lower = value.lower()
    if "watch?" in lower or "/watch/" in lower or "/shorts/" in lower or "youtu.be/" in lower:
        return False
    if _extract_channel_id(value):
        return True
    if _extract_handle(value):
        return True
    return "youtube.com/@" in lower or "youtube.com/channel/" in lower


class YoutubeConnector(BaseConnector):
    source_type = YOUTUBE
    label = "YouTube channel"
    detect_hint = "We'll fetch recent videos from this channel."

    def normalize_identifier(self, identifier: str) -> str:
        value = identifier.strip()
        channel_id = _extract_channel_id(value)
        if channel_id:
            return channel_id
        handle = _extract_handle(value)
        if handle:
            if value.startswith("http"):
                return value.rstrip("/")
            return f"@{handle}"
        return value

    def can_handle(self, identifier: str) -> bool:
        return looks_like_youtube(identifier)

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 8,
        source_name: str | None = None,
        meta: dict | None = None,
    ) -> list[NormalizedContent]:
        return await fetch_youtube_articles(
            self.normalize_identifier(identifier),
            limit=limit,
            settings=settings,
            source_name=source_name,
        )

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        if not looks_like_youtube(identifier):
            return ConnectorValidation(valid=False, message="Not a YouTube channel URL or handle.")
        handle = _extract_handle(identifier)
        if handle and " " in handle:
            return ConnectorValidation(
                valid=False,
                message="Use a full channel URL or @handle (e.g. youtube.com/@mkbhd).",
            )
        return ConnectorValidation(valid=True, suggested_name=f"YouTube · {handle or identifier}")
