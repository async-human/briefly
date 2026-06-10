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


def _headline_by_id(ctx: PipelineContext) -> dict[str, str]:
    return {item.id: (item.title or "").strip() for item in ctx.enriched_items if item.id}


def _connection_record(
    *,
    kind: str,
    body: str,
    content_id: str | None,
    strength: float,
    headline: str | None = None,
    thread_update: str | None = None,
    thread_key: str | None = None,
) -> dict:
    """Structured connection for UI — shows both today's story and the past link."""
    hl = (headline or "").strip()
    link = (body or "").strip()
    thread = (thread_update or "").strip()
    return {
        "kind": kind,
        "title": hl or link[:80] or "Connection",
        "headline": hl or None,
        "body": link,
        "thread_update": thread or None,
        "thread_key": (thread_key or "").strip() or None,
        "content_id": content_id,
        "strength": strength,
    }


async def _titles_for_ids(session, user_id: str, ids: list[str]) -> dict[str, str]:
    if not ids:
        return {}
    from briefly_api.db.models import RawContent

    try:
        result = await session.execute(
            select(RawContent.id, RawContent.title).where(
                RawContent.user_id == user_id,
                RawContent.id.in_(ids),
            )
        )
        return {row[0]: (row[1] or "").strip() for row in result.all() if row[1]}
    except Exception:
        log.debug("SerendipityAgent: title lookup failed", exc_info=True)
        return {}


async def run(ctx: PipelineContext) -> PipelineContext:
    session = ctx.db_session
    user_id = ctx.user.user_id
    selected = set(ctx.selected_item_ids)
    connections: list[dict] = []
    seen_bodies: set[str] = set()
    headlines = _headline_by_id(ctx)

    # Strong connections from today's selected items (enrichment cache)
    for cid in ctx.selected_item_ids:
        cached = ctx.enrichment_cache.get(cid, {})
        body = (cached.get("connection_sentence") or cached.get("thread_update") or "").strip()
        strength = float(cached.get("connection_strength") or 0)
        if not body or strength < _MIN_STRENGTH or body in seen_bodies:
            continue
        connections.append(
            _connection_record(
                kind="in_brief",
                body=body,
                content_id=cid,
                strength=strength,
                headline=headlines.get(cid),
                thread_update=cached.get("thread_update"),
                thread_key=cached.get("thread_key"),
            )
        )
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
            pending_rows = []
            for row in result.scalars().all():
                if row.content_id in selected:
                    continue
                body = (row.connection_sentence or row.thread_update or "").strip()
                if not body or body in seen_bodies:
                    continue
                pending_rows.append(row)
                if len(pending_rows) + len(connections) >= _MAX_CONNECTIONS + 5:
                    break

            extra_ids = [r.content_id for r in pending_rows if r.content_id not in headlines]
            title_map = await _titles_for_ids(session, user_id, extra_ids)

            for row in pending_rows:
                body = (row.connection_sentence or row.thread_update or "").strip()
                if body in seen_bodies:
                    continue
                connections.append(
                    _connection_record(
                        kind="history",
                        body=body,
                        content_id=row.content_id,
                        strength=float(row.connection_strength or 0),
                        headline=title_map.get(row.content_id) or headlines.get(row.content_id),
                        thread_update=row.thread_update,
                        thread_key=row.thread_key,
                    )
                )
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
                connections.append(
                    _connection_record(
                        kind="saved",
                        body=ref,
                        content_id=content_id,
                        strength=0.7,
                        headline=(headline or "").strip() or None,
                    )
                )
                seen_bodies.add(ref)
                if len(connections) >= _MAX_CONNECTIONS:
                    break
        except Exception:
            log.debug("SerendipityAgent: saved-item scan failed", exc_info=True)

    ctx.serendipity_connections = connections[:_MAX_CONNECTIONS]
    log.info("SerendipityAgent: %d connection(s) for user %s", len(ctx.serendipity_connections), user_id)
    return ctx
