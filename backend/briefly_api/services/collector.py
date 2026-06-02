from __future__ import annotations

import asyncio
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
from briefly_api.services.content_enrichment import enrich_medium_content

log = logging.getLogger(__name__)

# OAuth account sources need a larger fetch pool (many channels / newsletters).
_ACCOUNT_SOURCE_TYPES = {GMAIL, YOUTUBE_ACCOUNT, REDDIT_ACCOUNT}

# Per-source fetch timeout — email/Medium expansion needs more time.
_FETCH_TIMEOUT_SEC = 28.0
_FETCH_TIMEOUT_EMAIL_SEC = 90.0
_MAX_CONCURRENT_FETCHES = 8


def _fetch_limit(
    source_type: str,
    max_items: int,
    num_sources: int,
    *,
    expanded: bool = False,
) -> int:
    if source_type in _ACCOUNT_SOURCE_TYPES:
        return min(40, max(max_items * 4, 16))
    if expanded:
        return min(12, max(8, max_items // max(num_sources, 1) + 4))
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
    expanded_fetch: bool = False,
) -> tuple[list[NormalizedContent], list[str]]:
    """Fetch content from all supported sources via connector registry (parallel)."""
    active = [s for s in sources if s.source_type in FETCHABLE_SOURCE_TYPES]
    if not active:
        return [], []

    batches: list[list[NormalizedContent]] = []
    warnings: list[str] = []
    sem = asyncio.Semaphore(_MAX_CONCURRENT_FETCHES)

    async def _fetch_one(source: Source) -> tuple[Source, list[NormalizedContent] | None, str | None]:
        from briefly_api.db.engine import SessionLocal

        connector = get_connector(source.source_type)
        if not connector:
            return source, None, f"Unsupported source type: {source.source_type}"

        display_name = source.name
        source_limit = _fetch_limit(
            source.source_type, max_items, len(active), expanded=expanded_fetch,
        )
        fetch_timeout = (
            _FETCH_TIMEOUT_EMAIL_SEC
            if source.source_type in (EMAIL, GMAIL)
            else _FETCH_TIMEOUT_SEC
        )
        async with sem:
            async with SessionLocal() as fetch_session:
                try:
                    fetched = await asyncio.wait_for(
                        connector.fetch(
                            source.identifier,
                            settings,
                            limit=source_limit,
                            source_name=display_name,
                            meta={
                                **(source.meta or {}),
                                "user_id": user_id,
                                "source_id": source.id,
                            },
                            db=fetch_session,
                        ),
                        timeout=fetch_timeout,
                    )
                    await fetch_session.commit()
                    for item in fetched:
                        if display_name:
                            item.source_name = display_name
                        item.source_id = source.id
                    if fetched and user_id and source.source_type in (EMAIL, GMAIL):
                        fetched = await enrich_medium_content(
                            fetched,
                            fetch_session,
                            user_id,
                            source_name=display_name,
                            per_digest_limit=min(6, source_limit),
                        )
                    return source, fetched, None
                except asyncio.TimeoutError:
                    label = display_name or source.identifier
                    log.warning("Fetch timed out for source %s (%s)", source.identifier, source.source_type)
                    return source, None, f"Timed out fetching {label}"
                except Exception as exc:
                    log.exception("Failed to fetch source %s (%s)", source.identifier, source.source_type)
                    label = display_name or source.identifier
                    return source, None, f"Could not fetch {label}: {exc}"

    results = await asyncio.gather(*[_fetch_one(s) for s in active], return_exceptions=True)

    for result in results:
        if isinstance(result, Exception):
            warnings.append(f"Fetch error: {result}")
            continue
        source, fetched, warning = result
        if warning:
            warnings.append(warning)
        if fetched:
            batches.append(fetched)
        elif source.source_type in _ACCOUNT_SOURCE_TYPES:
            warnings.append(
                f"{source.name or source.source_type} returned no items — "
                "check connection settings or privacy."
            )

    if expanded_fetch:
        articles = [item for batch in batches for item in batch]
    else:
        articles = _interleave(batches, max_items)
    return articles, warnings
