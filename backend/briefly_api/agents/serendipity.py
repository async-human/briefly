"""
SerendipityAgent — surfaces cross-domain connections Briefly noticed.

Runs after proactive context is loaded, before the writer. Populates
ctx.serendipity_connections (1–3 items) for digest meta + UI.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from briefly_api.agents.context import PipelineContext
from briefly_api.db.models import ContentEnrichmentCache, DigestItem, Digest

log = logging.getLogger(__name__)

_MAX_CONNECTIONS = 3
_MIN_STRENGTH = 0.62


async def run(ctx: PipelineContext) -> PipelineContext:
    session = ctx.db_session
    user_id = ctx.user.user_id
    selected = set(ctx.selected_item_ids)
    connections: list[dict] = []
    seen_bodies: set[str] = set()

    # Strong connections from today's selected items (enrichment cache)
    for cid in ctx.selected_item_ids:
        cached = ctx.enrichment_cache.get(cid, {})
        body = (cached.get("connection_sentence") or "").strip()
        strength = float(cached.get("connection_strength") or 0)
        if not body or strength < _MIN_STRENGTH or body in seen_bodies:
            continue
        connections.append({
            "title": "Connection in today's brief",
            "body": body,
            "content_id": cid,
            "strength": strength,
        })
        seen_bodies.add(body)
        if len(connections) >= _MAX_CONNECTIONS:
            break

    # Cross-week connections from enrichment cache (not in today's brief)
    if session and len(connections) < _MAX_CONNECTIONS:
        cutoff = datetime.now(timezone.utc) - timedelta(days=14)
        try:
            result = await session.execute(
                select(ContentEnrichmentCache).where(
                    ContentEnrichmentCache.user_id == user_id,
                    ContentEnrichmentCache.connection_strength >= _MIN_STRENGTH,
                    ContentEnrichmentCache.enriched_at >= cutoff,
                ).order_by(ContentEnrichmentCache.connection_strength.desc()).limit(30)
            )
            for row in result.scalars().all():
                if row.content_id in selected:
                    continue
                body = (row.connection_sentence or "").strip()
                if not body or body in seen_bodies:
                    continue
                connections.append({
                    "title": "Connection Briefly noticed",
                    "body": body,
                    "content_id": row.content_id,
                    "strength": float(row.connection_strength or 0),
                })
                seen_bodies.add(body)
                if len(connections) >= _MAX_CONNECTIONS:
                    break
        except Exception:
            log.debug("SerendipityAgent: enrichment scan failed", exc_info=True)

    # Saved-item bridges: items user saved that connect to recent reading
    if session and len(connections) < _MAX_CONNECTIONS:
        try:
            saved_result = await session.execute(
                select(DigestItem.headline, DigestItem.content_id, DigestItem.memory_reference)
                .join(Digest, DigestItem.digest_id == Digest.id)
                .where(
                    Digest.user_id == user_id,
                    DigestItem.was_saved == True,
                    Digest.created_at >= datetime.now(timezone.utc) - timedelta(days=21),
                )
                .order_by(Digest.created_at.desc())
                .limit(10)
            )
            for headline, content_id, memory_ref in saved_result.all():
                ref = (memory_ref or "").strip()
                if not ref or ref in seen_bodies:
                    continue
                connections.append({
                    "title": "From something you saved",
                    "body": ref,
                    "content_id": content_id,
                    "headline": headline,
                    "strength": 0.7,
                })
                seen_bodies.add(ref)
                if len(connections) >= _MAX_CONNECTIONS:
                    break
        except Exception:
            log.debug("SerendipityAgent: saved-item scan failed", exc_info=True)

    ctx.serendipity_connections = connections[:_MAX_CONNECTIONS]
    log.info("SerendipityAgent: %d connection(s) for user %s", len(ctx.serendipity_connections), user_id)
    return ctx
