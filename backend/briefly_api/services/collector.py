from __future__ import annotations

import logging

from briefly_api.config import Settings
from briefly_api.db.models import Source
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.registry import get_connector
from briefly_api.services.connectors.types import EMAIL, FETCHABLE_SOURCE_TYPES

log = logging.getLogger(__name__)


async def collect_from_sources(
    sources: list[Source],
    settings: Settings,
    *,
    max_items: int = 8,
) -> tuple[list[NormalizedContent], list[str]]:
    """Fetch content from all supported sources via connector registry."""
    active = [s for s in sources if s.source_type in FETCHABLE_SOURCE_TYPES]
    if not active:
        return [], []

    per_source = max(2, max_items // len(active))
    articles: list[NormalizedContent] = []
    warnings: list[str] = []

    for source in active:
        connector = get_connector(source.source_type)
        if not connector:
            warnings.append(f"Unsupported source type: {source.source_type}")
            continue

        display_name = source.name
        try:
            fetched = await connector.fetch(
                source.identifier,
                settings,
                limit=per_source,
                source_name=display_name,
                meta=source.meta or {},
            )
            for item in fetched:
                if display_name:
                    item.source_name = display_name
            articles.extend(fetched)
        except Exception as exc:
            log.exception("Failed to fetch source %s (%s)", source.identifier, source.source_type)
            label = display_name or source.identifier
            warnings.append(f"Could not fetch {label}: {exc}")

    email_sources = [s for s in sources if s.source_type == EMAIL]
    if email_sources:
        warnings.append(
            f"{len(email_sources)} email source(s) skipped — forward newsletters to your ingestion address."
        )

    return articles[:max_items], warnings
