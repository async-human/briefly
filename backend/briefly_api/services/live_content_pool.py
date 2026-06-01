"""Persist live-fetched pipeline items into raw_contents so digest FK links succeed."""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.agents.context import RawItem
from briefly_api.db.models import ContentStatus, RawContent

log = logging.getLogger(__name__)


async def persist_live_raw_items(
    session: AsyncSession,
    user_id: str,
    items: list[RawItem],
) -> None:
    """
    Upsert live-fetched RawItems into raw_contents using the same IDs as RawItem.id.
    Required because digest_items.content_id FK references raw_contents.id.
    """
    if not items:
        return

    live = [i for i in items if not i.meta.get("from_pool")]
    if not live:
        return

    for item in live:
        item.meta["live_fetch"] = True
        if not item.source_id:
            continue
        existing = await session.get(RawContent, item.id)
        if existing:
            existing.title = item.title
            existing.url = item.url
            existing.author = item.author
            existing.published_at = item.published_at
            existing.clean_text = item.clean_text
            existing.summary = item.summary or item.clean_text[:400]
            existing.content_hash = item.content_hash or existing.content_hash
            existing.relevance_score = item.relevance_score or existing.relevance_score
            existing.status = ContentStatus.pending
            existing.meta = {**(existing.meta or {}), **(item.meta or {}), "live_fetch": True}
            continue

        session.add(
            RawContent(
                id=item.id,
                source_id=item.source_id,
                user_id=user_id,
                status=ContentStatus.pending,
                title=item.title,
                url=item.url,
                author=item.author,
                published_at=item.published_at,
                clean_text=item.clean_text,
                summary=item.summary or item.clean_text[:400],
                content_hash=item.content_hash,
                relevance_score=item.relevance_score or None,
                meta={**(item.meta or {}), "live_fetch": True},
            )
        )

    await session.flush()
    log.info("Persisted %d live item(s) to raw_contents for user %s", len(live), user_id)
