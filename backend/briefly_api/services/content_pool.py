"""Load pre-ingested RawContent rows as pipeline RawItems."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.agents.context import RawItem
from briefly_api.config import Settings, get_settings
from briefly_api.db.models import ContentStatus, RawContent, Source

log = logging.getLogger(__name__)


async def load_pool_as_raw_items(
    session: AsyncSession,
    user_id: str,
    sources: list[Source],
    *,
    settings: Settings | None = None,
) -> tuple[list[RawItem], int]:
    """
    Return RawItems from the ingestion pool (recent RawContent rows).
    Second value: count loaded from pool.
    """
    s = settings or get_settings()
    hours = s.pool_max_age_hours
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    source_ids = [src.id for src in sources]
    if not source_ids:
        return [], 0

    source_map = {src.id: src for src in sources}
    per_source = max(4, min(12, 120 // max(len(source_ids), 1)))
    rows: list[RawContent] = []

    # Fair load: up to N recent items per source (not global newest-only)
    for sid in source_ids:
        result = await session.execute(
            select(RawContent)
            .options(selectinload(RawContent.embedding))
            .where(
                RawContent.user_id == user_id,
                RawContent.source_id == sid,
                RawContent.ingested_at >= cutoff,
                RawContent.status.in_([ContentStatus.pending, ContentStatus.processed]),
            )
            .order_by(RawContent.ingested_at.desc())
            .limit(per_source)
        )
        rows.extend(result.scalars().all())

    items: list[RawItem] = []

    for rank, row in enumerate(rows):
        src = source_map.get(row.source_id)
        if not src:
            continue
        text = (row.clean_text or row.summary or row.title or "").strip()
        if not text and not row.title:
            continue
        embedding = None
        if row.embedding:
            embedding = list(row.embedding.embedding)

        items.append(
            RawItem(
                id=row.id,
                source_id=row.source_id,
                source_type=src.source_type,
                source_name=src.name or src.identifier,
                title=row.title or "",
                url=row.url,
                author=row.author,
                published_at=row.published_at,
                clean_text=text,
                content_hash=row.content_hash or "",
                summary=row.summary or text[:400],
                embedding=embedding,
                relevance_score=row.relevance_score or 0.5,
                meta={"fetch_rank": rank, "from_pool": True, **(row.meta or {})},
            )
        )

    log.info("Loaded %d pre-ingested items for user %s (pool window=%dh)", len(items), user_id, hours)
    return items, len(items)
