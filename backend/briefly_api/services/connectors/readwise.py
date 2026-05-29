"""
briefly_api/services/connectors/readwise.py

Fetches recently saved articles from Readwise Reader (or Readwise classic).
The API key is stored in Source.meta["api_key"].

Readwise Reader API: https://readwise.io/reader_api
We fetch documents with location "later" or "shortlist" (saved for later / highlights).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import READWISE

_READER_API = "https://readwise.io/api/v3/list/"
_CLASSIC_API = "https://readwise.io/api/v2/highlights/"


def _fetch_reader_documents_sync(api_key: str, limit: int) -> list[NormalizedContent]:
    headers = {"Authorization": f"Token {api_key}"}
    params = {
        "location": "later",
        "withHtmlContent": "false",
        "pageSize": str(min(limit, 50)),
    }
    results: list[NormalizedContent] = []
    try:
        with httpx.Client(timeout=20.0, headers=headers) as client:
            resp = client.get(_READER_API, params=params)
            resp.raise_for_status()
            data = resp.json()

        for doc in data.get("results", [])[:limit]:
            title = doc.get("title") or doc.get("url", "Saved article")
            url = doc.get("url") or doc.get("source_url") or ""
            summary = doc.get("summary") or doc.get("notes") or ""
            author = doc.get("author") or ""
            created_at = doc.get("created_at")
            published = None
            if created_at:
                try:
                    published = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                except ValueError:
                    pass

            if not url:
                continue

            results.append(NormalizedContent(
                title=title.strip(),
                url=url,
                source_name="Readwise",
                source_type=READWISE,
                section="Saved Reading",
                author=author,
                published_at=published,
                clean_text=summary or title,
                summary=summary[:400] if summary else title[:400],
            ))
    except httpx.HTTPStatusError:
        pass

    return results


class ReadwiseConnector(BaseConnector):
    source_type = READWISE
    label = "Readwise"
    detect_hint = "Your saved articles and highlights from Readwise Reader."

    def normalize_identifier(self, identifier: str) -> str:
        return "readwise"

    def can_handle(self, identifier: str) -> bool:
        return False  # Added via dedicated connect endpoint, not paste

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
        api_key = (meta or {}).get("api_key")
        if not api_key:
            raise ValueError("Readwise API key not configured.")
        return await asyncio.to_thread(_fetch_reader_documents_sync, api_key, limit)

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        return ConnectorValidation(valid=True, suggested_name="Readwise")
