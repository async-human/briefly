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


def _article_to_raw_item(article, source_rank: dict[str, int]) -> RawItem:
    text = article.clean_text or article.summary or article.title or ""
    content_hash = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()
    sid = article.source_id or ""
    rank = source_rank[sid]
    source_rank[sid] += 1
    return RawItem(
        id=str(uuid.uuid4()),
        source_id=sid,
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


async def _refresh_priority_source_items(
    session,
    ctx: PipelineContext,
    sources: list,
    settings,
    existing: list[RawItem],
) -> list[RawItem]:
    """Live-fetch starred sources so briefings don't rely on stale pool content."""
    from briefly_api.services.source_priority import PRIORITY_HIGH, priority_from_source

    priority_sources = [s for s in sources if priority_from_source(s) == PRIORITY_HIGH]
    if not priority_sources:
        return existing

    priority_ids = {s.id for s in priority_sources}
    articles, warnings = await collect_from_sources(
        priority_sources,
        settings,
        db=session,
        user_id=ctx.user.user_id,
        max_items=80,
        expanded_fetch=True,
    )
    for w in warnings:
        log.warning("SourceCollectorAgent: %s", w)

    kept = [item for item in existing if item.source_id not in priority_ids]
    replaced = [item for item in existing if item.source_id in priority_ids]
    replaced_by_hash = {item.content_hash: item for item in replaced if item.content_hash}

    source_rank: dict[str, int] = defaultdict(int)
    fresh: list[RawItem] = []
    existing_hashes = {item.content_hash for item in kept if item.content_hash}

    for article in articles:
        text = article.clean_text or article.summary or article.title or ""
        content_hash = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()
        if content_hash in existing_hashes:
            continue
        if content_hash in replaced_by_hash:
            fresh.append(replaced_by_hash[content_hash])
            existing_hashes.add(content_hash)
            continue
        existing_hashes.add(content_hash)
        fresh.append(_article_to_raw_item(article, source_rank))

    log.info(
        "SourceCollectorAgent: refreshed %d priority source(s) → %d live items",
        len(priority_sources), len(fresh),
    )
    return kept + fresh


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

    # Starred sources always get a fresh Gmail/RSS pull — pool alone misses new digests.
    if session:
        try:
            raw_items = await _refresh_priority_source_items(
                session, ctx, sources, s, raw_items,
            )
        except Exception as exc:
            log.exception("Priority source refresh failed for user %s", ctx.user.user_id)
            log.warning("SourceCollectorAgent: priority refresh failed: %s", exc)
        from_pool = sum(1 for i in raw_items if i.meta.get("from_pool"))

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
                log.warning("SourceCollectorAgent: %s", w)

            existing_ids = {item.content_hash for item in raw_items if item.content_hash}
            source_rank: dict[str, int] = defaultdict(int)
            for article in articles:
                text = article.clean_text or article.summary or article.title or ""
                content_hash = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()
                if content_hash in existing_ids:
                    continue
                existing_ids.add(content_hash)
                raw_items.append(_article_to_raw_item(article, source_rank))

    if session and raw_items:
        try:
            from briefly_api.services.live_content_pool import persist_live_raw_items

            await persist_live_raw_items(session, ctx.user.user_id, raw_items)
            await session.commit()
        except Exception as exc:
            await session.rollback()
            log.warning("Could not persist live items to pool: %s", exc)

    ctx.raw_items = raw_items
    ctx.total_ingested = len(raw_items)
    ctx.__dict__["pool_items_loaded"] = from_pool
    ctx.__dict__["live_items_loaded"] = len(raw_items) - from_pool
    log.info(
        "SourceCollectorAgent: %d items (pool=%d live=%d) from %d sources",
        len(raw_items), from_pool, len(raw_items) - from_pool, len(sources),
    )
    return ctx
