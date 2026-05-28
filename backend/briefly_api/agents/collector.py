"""
briefly_api/agents/collector.py

SourceCollectorAgent: fetches content from all active user sources
and converts it into RawItems for the rest of the pipeline.
"""
from __future__ import annotations

import hashlib
import logging
import uuid

from briefly_api.agents.context import PipelineContext, RawItem
from briefly_api.config import get_settings
from briefly_api.services.collector import collect_from_sources

log = logging.getLogger(__name__)


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Fetch content from all active sources for this user.
    Populates ctx.raw_items and ctx.total_ingested.
    """
    s = get_settings()
    sources = ctx.user.sources

    if not sources:
        log.warning("SourceCollectorAgent: user %s has no active sources", ctx.user.user_id)
        return ctx

    articles, warnings = await collect_from_sources(
        sources,
        s,
        db=ctx.db_session,
        user_id=ctx.user.user_id,
        max_items=60,
    )

    for w in warnings:
        ctx.log_error("SourceCollectorAgent", w)

    raw_items: list[RawItem] = []
    for article in articles:
        text = article.clean_text or article.summary or article.title or ""
        content_hash = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()

        raw_items.append(
            RawItem(
                id=str(uuid.uuid4()),
                source_id=article.source_id,
                source_type=article.source_type,
                source_name=article.source_name,
                title=article.title or "",
                url=article.url,
                author=article.author,
                published_at=article.published_at,
                clean_text=text,
                content_hash=content_hash,
                summary=article.summary or "",
            )
        )

    ctx.raw_items = raw_items
    ctx.total_ingested = len(raw_items)
    log.info(
        "SourceCollectorAgent: fetched %d items from %d sources (%d warnings)",
        len(raw_items), len(sources), len(warnings),
    )
    return ctx
