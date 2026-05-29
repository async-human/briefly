from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings
from briefly_api.db.models import Source
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.registry import get_connector
from briefly_api.services.connectors.types import (
    EMAIL,
    FETCHABLE_SOURCE_TYPES,
    GMAIL,
    REDDIT_ACCOUNT,
    YOUTUBE_ACCOUNT,
)

log = logging.getLogger(__name__)

# OAuth account sources need a larger fetch pool (many channels / newsletters).
_ACCOUNT_SOURCE_TYPES = {GMAIL, YOUTUBE_ACCOUNT, REDDIT_ACCOUNT}


def _fetch_limit(source_type: str, max_items: int, num_sources: int) -> int:
    if source_type in _ACCOUNT_SOURCE_TYPES:
        return min(40, max(max_items * 4, 16))
    return max(2, max_items // max(num_sources, 1))


def _interleave(lists: list[list[NormalizedContent]], max_items: int) -> list[NormalizedContent]:
    """Round-robin merge so one source doesn't dominate the briefing."""
    result: list[NormalizedContent] = []
    indices = [0] * len(lists)
    while len(result) < max_items:
        added = False
        for i, batch in enumerate(lists):
            if indices[i] < len(batch):
                result.append(batch[indices[i]])
                indices[i] += 1
                added = True
                if len(result) >= max_items:
                    break
        if not added:
            break
    return result


async def collect_from_sources(
    sources: list[Source],
    settings: Settings,
    db: AsyncSession,
    *,
    user_id: str,
    max_items: int = 8,
) -> tuple[list[NormalizedContent], list[str]]:
    """Fetch content from all supported sources via connector registry."""
    active = [s for s in sources if s.source_type in FETCHABLE_SOURCE_TYPES]
    if not active:
        return [], []

    batches: list[list[NormalizedContent]] = []
    warnings: list[str] = []

    for source in active:
        connector = get_connector(source.source_type)
        if not connector:
            warnings.append(f"Unsupported source type: {source.source_type}")
            continue

        display_name = source.name
        source_limit = _fetch_limit(source.source_type, max_items, len(active))
        try:
            fetched = await connector.fetch(
                source.identifier,
                settings,
                limit=source_limit,
                source_name=display_name,
                meta={**(source.meta or {}), "user_id": user_id},
                db=db,
            )
            for item in fetched:
                if display_name:
                    item.source_name = display_name
                item.source_id = source.id
            if fetched:
                batches.append(fetched)
            elif source.source_type in _ACCOUNT_SOURCE_TYPES:
                warnings.append(
                    f"{display_name or source.source_type} returned no items — "
                    "check connection settings or privacy."
                )
        except Exception as exc:
            log.exception("Failed to fetch source %s (%s)", source.identifier, source.source_type)
            label = display_name or source.identifier
            warnings.append(f"Could not fetch {label}: {exc}")

    email_sources = [s for s in sources if s.source_type == EMAIL]
    if email_sources:
        warnings.append(
            f"{len(email_sources)} email-forward source(s) skipped — connect Gmail instead."
        )

    articles = _interleave(batches, max_items)
    return articles, warnings
