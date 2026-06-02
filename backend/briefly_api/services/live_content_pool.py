"""Persist live-fetched pipeline items into raw_contents so digest FK links succeed."""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.agents.context import RawItem
from briefly_api.db.models import ContentStatus, RawContent

log = logging.getLogger(__name__)


def _apply_row_update(existing: RawContent, item: RawItem, user_id: str) -> None:
    existing.title = item.title
    existing.url = item.url
    existing.author = item.author
    existing.published_at = item.published_at
    existing.clean_text = item.clean_text
    existing.summary = item.summary or item.clean_text[:400]
    existing.content_hash = item.content_hash or existing.content_hash
    existing.relevance_score = item.relevance_score or existing.relevance_score
    existing.status = ContentStatus.pending
    existing.user_id = user_id
    existing.meta = {**(existing.meta or {}), **(item.meta or {}), "live_fetch": True}


async def _find_existing_row(
    session: AsyncSession,
    item: RawItem,
) -> RawContent | None:
    """Match by primary key first, then the (source_id, content_hash) unique key."""
    if item.id:
        row = await session.get(RawContent, item.id)
        if row:
            return row

    if not item.source_id or not item.content_hash:
        return None

    result = await session.execute(
        select(RawContent).where(
            RawContent.source_id == item.source_id,
            RawContent.content_hash == item.content_hash,
        )
    )
    return result.scalar_one_or_none()


async def persist_live_raw_items(
    session: AsyncSession,
    user_id: str,
    items: list[RawItem],
) -> None:
    """
    Upsert live-fetched RawItems into raw_contents.
    Remaps item.id to the existing DB row when content_hash already exists so
    digest_items.content_id FK references stay valid.
    """
    if not items:
        return

    live = [i for i in items if not i.meta.get("from_pool")]
    if not live:
        return

    persisted = 0
    for item in live:
        item.meta["live_fetch"] = True
        if not item.source_id:
            continue

        existing = await _find_existing_row(session, item)
        if existing:
            item.id = existing.id
            _apply_row_update(existing, item, user_id)
            persisted += 1
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
        persisted += 1

    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        log.warning(
            "Live pool persist hit duplicate content — retrying row-by-row: %s",
            exc.orig if hasattr(exc, "orig") else exc,
        )
        await _persist_live_raw_items_safe(session, user_id, live)
        return

    log.info("Persisted %d live item(s) to raw_contents for user %s", persisted, user_id)


async def _persist_live_raw_items_safe(
    session: AsyncSession,
    user_id: str,
    live: list[RawItem],
) -> None:
    """Row-by-row upsert fallback when a batch flush hits uq_content."""
    saved = 0
    for item in live:
        if not item.source_id:
            continue
        item.meta["live_fetch"] = True
        try:
            existing = await _find_existing_row(session, item)
            if existing:
                item.id = existing.id
                _apply_row_update(existing, item, user_id)
            else:
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
            saved += 1
        except IntegrityError:
            await session.rollback()
            existing = await _find_existing_row(session, item)
            if existing:
                item.id = existing.id
                _apply_row_update(existing, item, user_id)
                await session.flush()
                saved += 1
            else:
                log.warning(
                    "Skipping live item %s — duplicate content_hash=%s source=%s",
                    item.id,
                    item.content_hash,
                    item.source_id,
                )

    log.info("Persisted %d live item(s) to raw_contents (safe mode) for user %s", saved, user_id)
