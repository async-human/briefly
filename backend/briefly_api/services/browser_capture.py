"""
briefly_api/services/browser_capture.py

Browser extension capture: scrape URL → RawContent → embed → optional user note.
Items are guaranteed in the next briefing via browser_capture_injector.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings, get_settings
from briefly_api.db.models import (
    ContentEmbedding,
    ContentEnrichmentCache,
    ContentStatus,
    RawContent,
    Source,
    SourceStatus,
)
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.services.source_priority import PRIORITY_HIGH
from briefly_api.services.url_scraper import UrlFetchError, scrape_url

log = logging.getLogger(__name__)

BROWSER_CAPTURE_SOURCE_TYPE = "browser_capture"
BROWSER_CAPTURE_IDENTIFIER = "extension"
BROWSER_CAPTURE_SECTION = "From your browsing"
BROWSER_CAPTURE_SOURCE_LABEL = "Browser capture"
_MAX_INJECT_PER_DIGEST = 5
_INJECT_MAX_AGE_HOURS = 72


@dataclass
class BrowserCaptureResult:
    id: str
    title: str
    url: str
    summary: str
    user_note: str | None
    created_at: datetime
    already_saved: bool = False


async def capture_url(
    db: AsyncSession,
    user_id: str,
    url: str,
    *,
    page_title: str | None = None,
    user_note: str | None = None,
    settings: Settings | None = None,
) -> BrowserCaptureResult:
    """Scrape URL, persist to RawContent, embed. Returns existing row if URL already saved."""
    raw_url = url.strip()
    if not raw_url:
        raise ValueError("URL is required.")
    if len(raw_url) > 2048:
        raise ValueError("URL is too long.")

    parsed = urlparse(raw_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Enter a valid http(s) URL.")

    note = (user_note or "").strip()[:2000] or None
    s = settings or get_settings()
    source = await _get_or_create_source(db, user_id)

    content_hash = hashlib.sha256(raw_url.encode("utf-8")).hexdigest()
    existing = await db.execute(
        select(RawContent).where(
            RawContent.source_id == source.id,
            RawContent.content_hash == content_hash,
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        if note and note != (row.meta or {}).get("user_note"):
            meta = dict(row.meta or {})
            meta["user_note"] = note
            row.meta = meta
            await db.flush()
        return BrowserCaptureResult(
            id=row.id,
            title=row.title or page_title or raw_url,
            url=row.url or raw_url,
            summary=row.summary or row.clean_text or "",
            user_note=(row.meta or {}).get("user_note"),
            created_at=row.ingested_at or datetime.now(timezone.utc),
            already_saved=True,
        )

    try:
        articles = await scrape_url(raw_url)
    except UrlFetchError as exc:
        raise ValueError(str(exc)) from exc

    article = articles[0]
    title = (page_title or article.title or "Saved article").strip()[:500]
    summary = (article.summary or article.clean_text or "")[:4000]
    clean_text = (article.clean_text or summary)[:50_000]

    meta = {
        "browser_capture": True,
        "should_inject_into_morning_brief": True,
        "capture_url": article.url or raw_url,
        "section": BROWSER_CAPTURE_SECTION,
    }
    if note:
        meta["user_note"] = note

    row = RawContent(
        source_id=source.id,
        user_id=user_id,
        status=ContentStatus.processed,
        title=title,
        url=article.url or raw_url,
        author=article.author,
        published_at=article.published_at,
        raw_text=clean_text,
        clean_text=clean_text,
        summary=summary[:4000],
        content_hash=content_hash,
        relevance_score=1.0,
        meta=meta,
    )
    db.add(row)
    await db.flush()

    embedder = get_embedding_adapter(s)
    embed_text = embedder.embed_text_for_content(title, summary[:400], BROWSER_CAPTURE_SECTION)
    embedding = await embedder.embed(embed_text)
    db.add(
        ContentEmbedding(
            content_id=row.id,
            embedding=embedding,
            model=s.embedding_model if s.embedding_provider == "voyage" else "text-embedding-3-small",
        )
    )
    await db.commit()
    await db.refresh(row)

    log.info("Browser capture saved for user %s (id=%s, url=%s)", user_id, row.id, raw_url)
    return BrowserCaptureResult(
        id=row.id,
        title=title,
        url=row.url or raw_url,
        summary=summary[:400],
        user_note=note,
        created_at=row.ingested_at or datetime.now(timezone.utc),
    )


async def get_pending_for_morning_brief(
    db: AsyncSession,
    user_id: str,
    *,
    limit: int = _MAX_INJECT_PER_DIGEST,
    max_age_hours: int = _INJECT_MAX_AGE_HOURS,
) -> list[tuple[RawContent, ContentEnrichmentCache | None]]:
    """Captures flagged for injection that haven't appeared in a digest yet."""
    source = await _get_or_create_source(db, user_id)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)

    result = await db.execute(
        select(RawContent)
        .where(
            RawContent.user_id == user_id,
            RawContent.source_id == source.id,
            RawContent.ingested_at >= cutoff,
        )
        .order_by(RawContent.ingested_at.desc())
        .limit(limit * 3)
    )
    rows = result.scalars().all()

    pending: list[tuple[RawContent, ContentEnrichmentCache | None]] = []
    for row in rows:
        meta = row.meta or {}
        if not meta.get("browser_capture"):
            continue
        if not meta.get("should_inject_into_morning_brief"):
            continue
        if meta.get("injected_at") or meta.get("injected_digest_id"):
            continue

        enrich_result = await db.execute(
            select(ContentEnrichmentCache).where(
                ContentEnrichmentCache.content_id == row.id,
                ContentEnrichmentCache.user_id == user_id,
            )
        )
        enrichment = enrich_result.scalar_one_or_none()
        pending.append((row, enrichment))
        if len(pending) >= limit:
            break

    return pending


async def mark_captures_injected(
    db: AsyncSession,
    capture_ids: list[str],
    digest_id: str,
) -> None:
    if not capture_ids:
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.execute(select(RawContent).where(RawContent.id.in_(capture_ids)))
    for row in result.scalars().all():
        meta = dict(row.meta or {})
        meta["injected_at"] = now_iso
        meta["injected_digest_id"] = digest_id
        meta["should_inject_into_morning_brief"] = False
        row.meta = meta
    await db.flush()


def why_it_matters_for_capture(
    row: RawContent,
    enrichment: ContentEnrichmentCache | None,
) -> str:
    meta = row.meta or {}
    parts: list[str] = []

    if enrichment and enrichment.connection_sentence:
        parts.append(enrichment.connection_sentence)
    elif enrichment and enrichment.why_relevant:
        parts.append(enrichment.why_relevant)
    else:
        parts.append("You saved this from your browser — Briefly will weave it into your briefing.")

    note = meta.get("user_note")
    if note:
        parts.append(f'You noted: "{note[:200]}"')

    return " ".join(parts)


@dataclass
class BrowserCaptureListItem:
    id: str
    title: str
    url: str | None
    summary: str
    user_note: str | None
    created_at: datetime
    in_briefing: bool
    connection_sentence: str | None
    thread_label: str | None
    why_relevant: str | None


async def list_recent_captures(
    db: AsyncSession,
    user_id: str,
    *,
    limit: int = 50,
) -> list[BrowserCaptureListItem]:
    """All extension captures for the Saved page, newest first."""
    source = await _get_or_create_source(db, user_id)

    result = await db.execute(
        select(RawContent)
        .where(
            RawContent.user_id == user_id,
            RawContent.source_id == source.id,
        )
        .order_by(RawContent.ingested_at.desc())
        .limit(limit)
    )
    rows = result.scalars().all()
    if not rows:
        return []

    row_ids = [r.id for r in rows]
    enrich_result = await db.execute(
        select(ContentEnrichmentCache).where(
            ContentEnrichmentCache.user_id == user_id,
            ContentEnrichmentCache.content_id.in_(row_ids),
        )
    )
    enrich_by_id = {e.content_id: e for e in enrich_result.scalars().all()}

    items: list[BrowserCaptureListItem] = []
    for row in rows:
        meta = row.meta or {}
        if not meta.get("browser_capture"):
            continue
        enrichment = enrich_by_id.get(row.id)
        thread_key = enrichment.thread_key if enrichment else None
        items.append(
            BrowserCaptureListItem(
                id=row.id,
                title=row.title or "Saved article",
                url=row.url,
                summary=(row.summary or row.clean_text or "")[:400],
                user_note=meta.get("user_note"),
                created_at=row.ingested_at or datetime.now(timezone.utc),
                in_briefing=bool(meta.get("injected_at") or meta.get("injected_digest_id")),
                connection_sentence=enrichment.connection_sentence if enrichment else None,
                thread_label=_thread_label(thread_key) if thread_key else None,
                why_relevant=enrichment.why_relevant if enrichment else None,
            )
        )
    return items


def build_capture_feedback(
    row: RawContent,
    enrichment: ContentEnrichmentCache | None,
    *,
    thread_item_count: int = 0,
) -> dict:
    """Human-readable feedback for the extension popup."""
    thread_key = enrichment.thread_key if enrichment else None
    thread_label = _thread_label(thread_key) if thread_key else None

    connection_line = None
    if enrichment and enrichment.connection_sentence:
        connection_line = enrichment.connection_sentence
    elif enrichment and enrichment.thread_update:
        connection_line = enrichment.thread_update

    briefing_message = "Will appear in tomorrow's briefing."
    if thread_label and thread_item_count > 0:
        briefing_message = (
            f"This is the {thread_item_count}{_ordinal_suffix(thread_item_count)} item "
            f"you've saved on {thread_label} this week. "
            "I'm elevating this thread in tomorrow's briefing."
        )
    elif thread_label:
        briefing_message = (
            f"Connects to your {thread_label} thread. "
            "Will appear in tomorrow's briefing."
        )

    return {
        "connection_sentence": connection_line,
        "thread_key": thread_key,
        "thread_label": thread_label,
        "thread_item_count": thread_item_count or None,
        "why_relevant": enrichment.why_relevant if enrichment else None,
        "briefing_message": briefing_message,
    }


async def _get_or_create_source(db: AsyncSession, user_id: str) -> Source:
    result = await db.execute(
        select(Source).where(
            Source.user_id == user_id,
            Source.source_type == BROWSER_CAPTURE_SOURCE_TYPE,
            Source.identifier == BROWSER_CAPTURE_IDENTIFIER,
        )
    )
    source = result.scalar_one_or_none()
    if source:
        return source

    source = Source(
        user_id=user_id,
        source_type=BROWSER_CAPTURE_SOURCE_TYPE,
        identifier=BROWSER_CAPTURE_IDENTIFIER,
        name="Browser captures",
        status=SourceStatus.active,
        meta={
            "description": "Articles saved via the Briefly browser extension",
            "priority": PRIORITY_HIGH,
        },
    )
    db.add(source)
    await db.flush()
    return source


def _thread_label(thread_key: str) -> str:
    return thread_key.replace("_", " ").replace("-", " ").strip()


def _ordinal_suffix(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
