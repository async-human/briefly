"""
briefly_api/agents/collector.py

SourceCollectorAgent: loads pre-ingested content pool, supplements with live fetch if needed.
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from briefly_api.agents.context import PipelineContext, RawItem
from briefly_api.config import get_settings
from briefly_api.services.collector import collect_from_sources
from briefly_api.services.content_ingestion import ingest_user_sources
from briefly_api.services.content_pool import load_pool_as_raw_items

log = logging.getLogger(__name__)


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Load content for the pipeline — pool-first (V1.5), live fetch as fallback/top-up.
    """
    s = get_settings()
    sources = ctx.user.sources
    session = ctx.db_session

    if not sources:
        log.warning("SourceCollectorAgent: user %s has no active sources", ctx.user.user_id)
        return ctx

    raw_items: list[RawItem] = []
    from_pool = 0

    if s.use_preingested_pool and session:
        raw_items, from_pool = await load_pool_as_raw_items(
            session, ctx.user.user_id, sources, settings=s,
        )

    min_needed = s.min_pool_items_before_live_fetch
    if len(raw_items) < min_needed:
        # Pool too thin — run incremental ingest then reload, or live fetch
        if session:
            try:
                await ingest_user_sources(session, ctx.user.user_id, settings=s)
                raw_items, from_pool = await load_pool_as_raw_items(
                    session, ctx.user.user_id, sources, settings=s,
                )
            except Exception as exc:
                log.warning("Inline ingestion failed: %s", exc)
                ctx.log_error("SourceCollectorAgent", f"Ingestion top-up failed: {exc}")

        if len(raw_items) < min_needed:
            articles, warnings = await collect_from_sources(
                sources,
                s,
                db=session,
                user_id=ctx.user.user_id,
                max_items=80,
                expanded_fetch=True,
            )
            for w in warnings:
                ctx.log_error("SourceCollectorAgent", w)

            existing_ids = {item.content_hash for item in raw_items if item.content_hash}
            source_rank: dict[str, int] = defaultdict(int)
            for article in articles:
                text = article.clean_text or article.summary or article.title or ""
                content_hash = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()
                if content_hash in existing_ids:
                    continue
                rank = source_rank[article.source_id]
                source_rank[article.source_id] += 1
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
                        meta={"fetch_rank": rank, "from_pool": False, **(article.meta or {})},
                    )
                )

    ctx.raw_items = raw_items
    ctx.total_ingested = len(raw_items)
    ctx.__dict__["pool_items_loaded"] = from_pool
    ctx.__dict__["live_items_loaded"] = len(raw_items) - from_pool
    log.info(
        "SourceCollectorAgent: %d items (pool=%d live=%d) from %d sources",
        len(raw_items), from_pool, len(raw_items) - from_pool, len(sources),
    )
    return ctx
