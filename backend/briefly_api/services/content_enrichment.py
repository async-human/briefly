"""Post-fetch content enrichment — keeps connectors as pure fetchers."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.services.articles import NormalizedContent
from briefly_api.services.medium_extractor import detect_medium_digest
from briefly_api.services.medium_ingestion import expand_medium_digest_items
from briefly_api.services.profile_signals import load_profile_signals


def tag_medium_digests(items: list[NormalizedContent]) -> None:
    """Mark Medium digest emails in-place without fetching articles."""
    for item in items:
        raw_html = item.meta.get("raw_html", "")
        author = item.author or item.meta.get("sender")
        if detect_medium_digest(raw_html, author):
            item.meta["is_medium_digest"] = True


async def enrich_medium_content(
    items: list[NormalizedContent],
    db: AsyncSession,
    user_id: str,
    *,
    source_name: str | None,
    source_id: str | None = None,
    per_digest_limit: int,
) -> list[NormalizedContent]:
    if not items:
        return items
    tag_medium_digests(items)
    keywords, profile_embedding = await load_profile_signals(db, user_id)
    return await expand_medium_digest_items(
        items,
        source_name=source_name,
        source_id=source_id,
        per_digest_limit=per_digest_limit,
        interest_keywords=keywords,
        profile_embedding=profile_embedding,
    )
