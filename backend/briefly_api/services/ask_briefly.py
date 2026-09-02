"""
Ask Briefly — RAG chat over the user's personal corpus.

Retrieves from ContentEmbedding + enrichment cache, answers with citations,
persists to FollowUpThread.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import (
    BehavioralSignal,
    ContentEmbedding,
    ContentEnrichmentCache,
    Digest,
    DigestItem,
    FollowUpThread,
    RawContent,
    SignalType,
    Source,
    User,
    UserProfile,
)
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.corpus_queries import (
    extract_topic_terms,
    is_corpus_library_query,
    is_saved_queue_only_query,
)
from briefly_api.services.profile_utils import cluster_label, iter_topic_clusters
from briefly_api.services.url_scraper import UrlFetchError, scrape_url

logger = logging.getLogger(__name__)

_CITATION_RE = re.compile(r"\[S(\d+)\]")
_SAVED_UNREAD_QUERY = re.compile(
    r"(?:"
    r"what\s+(?:did|have)\s+i\s+save|saved\s+recently|"
    r"(?:my\s+)?(?:saved|saves|reading\s+list|read(?:ing)?\s+list|backlog)|"
    r"haven'?t\s+read|have\s+not\s+read|not\s+read\s+yet|unread|"
    r"save(?:d)?\s+.+\s+(?:not\s+read|unread|yet\s+to\s+read)"
    r")",
    re.IGNORECASE,
)
_TODAY_BRIEF_QUERY = re.compile(
    r"(?:"
    r"today(?:'s|\s+is)?\s+(?:brief|briefing|briefs)|"
    r"(?:my\s+)?(?:brief|briefing)\s+(?:for\s+)?today|"
    r"what(?:'s|\s+is)?\s+(?:in|on)\s+(?:my\s+)?(?:today'?s?\s+)?brief"
    r")",
    re.IGNORECASE,
)
_MAX_HISTORY = 8
_MAX_RETRIEVAL_POOL = 250
_MAX_CHUNKS = 8
_MAX_CORPUS_CHUNKS = 12
_MIN_SIMILARITY = 0.32
_MIN_CORPUS_SIMILARITY = 0.24
_SAVED_UNREAD_LIMIT = 12
_ARTICLE_CHUNK_CHARS = 750
_ARTICLE_CHUNK_OVERLAP = 120
_MAX_ARTICLE_PASSAGES = 5
_MAX_FOCUSED_PASSAGES = 8
_MAX_ARTICLE_CHUNKS_TO_SCORE = 28
_MIN_PASSAGE_SIMILARITY = 0.22
_MAX_ANCHOR_SNIPPET_CHARS = 8000
_REFERENTIAL_FOLLOWUP = re.compile(
    r"(?:"
    r"\b(?:this|the|that|same)\s+(?:article|story|piece|post|read|item|source|topic|subject)\b|"
    r"\b(?:it|this|that)\s+(?:says|said|mentions|mentioned|discusses|discussed|covers|covered)\b|"
    r"\babout\s+(?:it|this|that)\b|"
    r"\b(?:go|dive)\s+(?:deeper|in\s+depth)\b|"
    r"\b(?:more details|more detail|more info|more information|tell me more|go on|go deeper|"
    r"keep going|say more|elaborate|expand on|explain more|provide more|anything else|"
    r"what else|continue|more on that)\b"
    r")",
    re.IGNORECASE,
)
_VAGUE_CONTINUATION_RE = re.compile(
    r"\b(?:"
    r"more details|more detail|more info|more information|tell me more|go on|go deeper|"
    r"keep going|say more|elaborate|expand on|explain more|provide more|anything else|"
    r"what else|continue|more on that|can you provide|could you provide|give me more|"
    r"dive deeper|in more depth|be more specific"
    r")\b",
    re.IGNORECASE,
)
_THIN_BODY_CHARS = 600
_FULL_BODY_PASSAGE_LIMIT = 7000
_EXTRACTION_QUERY = re.compile(
    r"\b(?:which|what|who|name|names|list|companies|company|startups|startup|firms|organizations|mentioned)\b",
    re.IGNORECASE,
)


@dataclass
class ContextChunk:
    ref: str
    content_id: str
    title: str
    url: str | None
    source_name: str | None
    snippet: str
    kind: str  # article | brain_dump | brief_anchor | decision_timeline


@dataclass
class AskPrepared:
    thread: FollowUpThread
    message: str
    all_chunks: list[ContextChunk]
    llm_messages: list[Message]
    digest_item_id: str | None
    content_id: str | None
    user_id: str
    focused: bool = False
    focus_title: str | None = None


@dataclass
class _AskPersistSnapshot:
    """Plain data for persisting after the LLM stream — no ORM session required."""

    thread_id: str
    user_id: str
    message: str
    content_id: str | None
    digest_item_id: str | None
    prior_messages: list
    thread_content_id: str | None
    thread_digest_item_id: str | None


def _ask_persist_snapshot(prepared: AskPrepared) -> _AskPersistSnapshot:
    return _AskPersistSnapshot(
        thread_id=prepared.thread.id,
        user_id=prepared.user_id,
        message=prepared.message,
        content_id=prepared.content_id,
        digest_item_id=prepared.digest_item_id,
        prior_messages=list(prepared.thread.messages or []),
        thread_content_id=prepared.thread.content_id,
        thread_digest_item_id=prepared.thread.digest_item_id,
    )


async def _load_user_for_ask(db: AsyncSession, user_id: str) -> User:
    result = await db.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user_id, User.is_active.is_(True))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise ValueError("User not found.")
    return user


def _cosine(a: list[float], b: list[float]) -> float:
    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


def rank_by_similarity(
    query_embedding: list[float],
    candidates: list[tuple[str, list[float]]],
    *,
    limit: int,
    exclude_ids: set[str] | None = None,
    min_similarity: float = _MIN_SIMILARITY,
) -> list[tuple[str, float]]:
    """Return content_ids sorted by cosine similarity descending."""
    exclude = exclude_ids or set()
    scored: list[tuple[str, float]] = []
    for content_id, emb in candidates:
        if content_id in exclude:
            continue
        sim = _cosine(query_embedding, emb)
        if sim >= min_similarity:
            scored.append((content_id, sim))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]


def _profile_blurb(profile: UserProfile | None) -> str:
    if not profile:
        return "No profile on file."
    parts: list[str] = []
    if profile.role:
        parts.append(f"Role: {profile.role}")
    if profile.goal:
        parts.append(f"Goal: {profile.goal}")
    clusters = [
        cluster_label(c)
        for c in iter_topic_clusters(profile.topic_clusters or [])
        if cluster_label(c)
    ][:6]
    if clusters:
        parts.append("Active interests: " + ", ".join(clusters))
    if profile.never_show:
        parts.append("Never show: " + ", ".join(profile.never_show[:8]))
    return "\n".join(parts) if parts else "General reader."


def _never_show_block(text: str, never_show: list[str]) -> bool:
    if not never_show or not text:
        return False
    hay = text.lower()
    return any(term.lower() in hay for term in never_show if term)


def is_saved_unread_query(message: str) -> bool:
    """True when the user is asking about their saved / unread backlog."""
    text = message.strip()
    if _TODAY_BRIEF_QUERY.search(text):
        return False
    return is_saved_queue_only_query(text)


def is_today_brief_query(message: str) -> bool:
    return bool(_TODAY_BRIEF_QUERY.search(message.strip()))


async def _retrieve_today_brief(
    db: AsyncSession,
    user_id: str,
    *,
    never_show: list[str],
    limit: int = 12,
) -> list[ContextChunk]:
    # "Today" must be the user's LOCAL date — digest_date is written in the
    # user's timezone, not UTC. Comparing against UTC's date is why a brief that
    # has been generated reads as "not ready" for any user whose local date
    # differs from UTC (e.g. IST is +5:30).
    profile = (
        await db.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    ).scalar_one_or_none()
    tz_name = getattr(profile, "digest_timezone", None) or "UTC"
    try:
        local_today = datetime.now(ZoneInfo(tz_name)).date()
    except Exception:
        local_today = datetime.now(timezone.utc).date()

    # Grab the most recent brief and accept it if it's today (local) or at most
    # ~2 days old — so "brief me on the current brief" always surfaces the
    # latest available one instead of falsely reporting "not ready".
    digest = (
        await db.execute(
            select(Digest)
            .where(Digest.user_id == user_id)
            .order_by(Digest.digest_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not digest:
        return []
    try:
        if (local_today - date.fromisoformat(digest.digest_date)).days > 2:
            return []
    except (TypeError, ValueError):
        pass
    items_result = await db.execute(
        select(DigestItem)
        .where(DigestItem.digest_id == digest.id)
        .order_by(DigestItem.position.asc())
        .limit(limit)
    )
    chunks: list[ContextChunk] = []
    for item in items_result.scalars().all():
        blob = f"{item.headline} {item.summary} {item.why_it_matters}"
        if _never_show_block(blob, never_show):
            continue
        chunks.append(
            ContextChunk(
                ref="",
                content_id=item.content_id or f"digest-item:{item.id}",
                title=item.headline,
                url=item.source_url,
                source_name=item.source_name or "Briefing",
                snippet=(f"{item.summary}\n\nWhy it matters: {item.why_it_matters}")[:1200],
                kind="today_brief",
            )
        )
    return chunks


async def _retrieve_saved_unread(
    db: AsyncSession,
    user_id: str,
    *,
    never_show: list[str],
    limit: int = _SAVED_UNREAD_LIMIT,
) -> list[ContextChunk]:
    """
  List items the user saved but has not opened in Briefly:
  - Briefing items starred (was_saved) without a click
  - Browser captures still queued (not yet surfaced in a briefing)
  - Browser captures in a briefing whose digest item was never clicked
    """
    chunks: list[ContextChunk] = []
    seen_content: set[str] = set()

    digest_result = await db.execute(
        select(DigestItem, Digest)
        .join(Digest, DigestItem.digest_id == Digest.id)
        .where(
            Digest.user_id == user_id,
            DigestItem.was_saved.is_(True),
            DigestItem.was_clicked.is_(False),
        )
        .order_by(Digest.digest_date.desc(), DigestItem.position)
        .limit(limit)
    )
    for item, digest in digest_result.all():
        cid = item.content_id or f"digest-item:{item.id}"
        if cid in seen_content:
            continue
        blob = f"{item.headline} {item.summary}"
        if _never_show_block(blob, never_show):
            continue
        seen_content.add(cid)
        snippet = (
            f"Saved from briefing on {digest.digest_date}. Not yet opened.\n"
            f"{item.summary}\n\nWhy it matters: {item.why_it_matters}"
        )[:1200]
        chunks.append(
            ContextChunk(
                ref="",
                content_id=cid if not str(cid).startswith("digest-item:") else item.id,
                title=item.headline,
                url=item.source_url,
                source_name=item.source_name or "Briefing",
                snippet=snippet,
                kind="saved_unread",
            )
        )

    captures = await list_recent_captures(db, user_id, limit=limit)
    clicked_content: set[str] = set()
    if captures:
        cap_ids = [c.id for c in captures]
        clicked_result = await db.execute(
            select(DigestItem.content_id)
            .join(Digest, DigestItem.digest_id == Digest.id)
            .where(
                Digest.user_id == user_id,
                DigestItem.content_id.in_(cap_ids),
                DigestItem.was_clicked.is_(True),
            )
        )
        clicked_content = {row[0] for row in clicked_result.all() if row[0]}

    for cap in captures:
        if len(chunks) >= limit:
            break
        if cap.id in seen_content:
            continue
        if cap.id in clicked_content:
            continue
        blob = f"{cap.title} {cap.summary}"
        if _never_show_block(blob, never_show):
            continue
        seen_content.add(cap.id)
        if cap.in_briefing:
            status = "Surfaced in a briefing but not opened yet."
        else:
            status = "Saved via browser — queued, not yet in a briefing."
        note = f"\nYour note: {cap.user_note}" if cap.user_note else ""
        snippet = f"{status}\n{cap.summary}{note}"[:1200]
        chunks.append(
            ContextChunk(
                ref="",
                content_id=cap.id,
                title=cap.title,
                url=cap.url,
                source_name="Saved",
                snippet=snippet,
                kind="saved_unread",
            )
        )

    return chunks[:limit]


def _is_extraction_query(query: str) -> bool:
    return bool(_EXTRACTION_QUERY.search(query))


def _is_thin_article_body(raw: RawContent) -> bool:
    clean = (raw.clean_text or "").strip()
    summary = (raw.summary or "").strip()
    if not clean:
        return True
    if len(clean) < _THIN_BODY_CHARS:
        return True
    if summary and clean == summary:
        return True
    if summary and len(clean) <= len(summary) + 80 and len(clean) < 1500:
        return True
    return False


def _cached_full_text(raw: RawContent) -> str | None:
    meta = raw.meta or {}
    cached = meta.get("full_article_text")
    if isinstance(cached, str) and cached.strip():
        return cached.strip()
    return None


async def _resolve_article_body(db: AsyncSession, raw: RawContent) -> str:
    """Return the best article body, fetching the live page when stored text is RSS-thin."""
    clean = (raw.clean_text or "").strip()
    cached = _cached_full_text(raw)
    if cached and (not clean or len(cached) > max(len(clean) + 50, len(clean) * 2)):
        return cached

    if clean and not _is_thin_article_body(raw):
        return clean

    url = (raw.url or "").strip()
    if not url:
        return clean or (raw.summary or "").strip()

    try:
        articles = await scrape_url(url)
    except UrlFetchError as exc:
        logger.info("Ask RAG: could not fetch full article %s: %s", url, exc)
        return clean or (raw.summary or "").strip()

    if not articles:
        return clean or (raw.summary or "").strip()

    fetched = (articles[0].clean_text or "").strip()
    if not fetched or len(fetched) <= len(clean):
        return clean or (raw.summary or "").strip()

    meta = dict(raw.meta or {})
    meta["full_article_text"] = fetched
    meta["full_text_fetched_at"] = datetime.now(timezone.utc).isoformat()
    raw.meta = meta
    await db.flush()
    logger.info(
        "Ask RAG: fetched full article for content %s (%d chars from %s)",
        raw.id,
        len(fetched),
        url,
    )
    return fetched


def _keyword_passage_boost(query: str, passage: str) -> float:
    query_tokens = {
        token
        for token in re.findall(r"[a-z0-9]{3,}", query.lower())
        if token not in {"which", "what", "who", "the", "are", "was", "were", "that", "this", "from"}
    }
    if not query_tokens:
        return 0.0
    passage_lower = passage.lower()
    hits = sum(1 for token in query_tokens if token in passage_lower)
    list_bonus = 0.12 if re.search(r"(?:,|\band\b|\d+\.)", passage) else 0.0
    return min(0.35, (hits / len(query_tokens)) * 0.25 + list_bonus)


def _split_article_passages(text: str) -> list[str]:
    """Split article body into overlapping passages for within-article retrieval."""
    text = re.sub(r"\n{3,}", "\n\n", text.strip())
    if not text:
        return []
    if len(text) <= _ARTICLE_CHUNK_CHARS:
        return [text]

    paragraphs = [p.strip() for p in re.split(r"\n\n+", text) if p.strip()]
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        if len(para) > _ARTICLE_CHUNK_CHARS:
            if current:
                chunks.append(current)
                current = ""
            start = 0
            while start < len(para):
                end = min(start + _ARTICLE_CHUNK_CHARS, len(para))
                chunks.append(para[start:end])
                if end >= len(para):
                    break
                start = end - _ARTICLE_CHUNK_OVERLAP
            continue

        candidate = f"{current}\n\n{para}".strip() if current else para
        if len(candidate) <= _ARTICLE_CHUNK_CHARS:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = para

    if current:
        chunks.append(current)
    return chunks


async def _retrieve_article_passages(
    clean_text: str,
    query_embedding: list[float],
    embedder,
    *,
    query: str = "",
    limit: int = _MAX_ARTICLE_PASSAGES,
) -> list[str]:
    """Return the passages from one article most relevant to the user's question."""
    passages = _split_article_passages(clean_text)
    if not passages:
        return []
    if len(passages) == 1:
        return passages

    extraction = _is_extraction_query(query)
    min_sim = 0.12 if extraction else _MIN_PASSAGE_SIMILARITY

    to_score = passages[:_MAX_ARTICLE_CHUNKS_TO_SCORE]
    embeddings = await embedder.embed_batch(to_score)
    scored = []
    for emb, passage in zip(embeddings, to_score, strict=True):
        sim = _cosine(query_embedding, emb)
        if extraction:
            sim += _keyword_passage_boost(query, passage)
        scored.append((sim, passage))
    scored.sort(key=lambda row: row[0], reverse=True)

    selected: list[str] = []
    seen_prefixes: set[str] = set()
    for sim, passage in scored:
        if sim < min_sim:
            continue
        prefix = passage[:100]
        if prefix in seen_prefixes:
            continue
        seen_prefixes.add(prefix)
        selected.append(passage)
        if len(selected) >= limit:
            break

    if not selected:
        selected = [scored[0][1]] if scored else [passages[0]]
        if passages[0] not in selected:
            selected.insert(0, passages[0])

    return selected[:limit]


async def _article_snippet_for_query(
    db: AsyncSession,
    user_id: str,
    raw: RawContent,
    *,
    query: str,
    query_embedding: list[float] | None,
    embedder,
    digest_blurb: str | None = None,
) -> str:
    """Build the best available text context for a focused article question."""
    clean_text = await _resolve_article_body(db, raw)
    summary = (raw.summary or "").strip()
    if not clean_text:
        clean_text = summary

    if len(clean_text) <= _FULL_BODY_PASSAGE_LIMIT:
        snippet = clean_text
    elif query_embedding and embedder and len(clean_text) > 200:
        passage_limit = _MAX_FOCUSED_PASSAGES if _is_extraction_query(query) else _MAX_ARTICLE_PASSAGES
        passages = await _retrieve_article_passages(
            clean_text,
            query_embedding,
            embedder,
            query=query,
            limit=passage_limit,
        )
        snippet = "\n\n---\n\n".join(passages)
    else:
        snippet = summary or clean_text[:1200]

    if digest_blurb:
        snippet = f"{digest_blurb}\n\n---\n\n{snippet}"

    enrich = await db.execute(
        select(ContentEnrichmentCache).where(
            ContentEnrichmentCache.user_id == user_id,
            ContentEnrichmentCache.content_id == raw.id,
        )
    )
    enrichment = enrich.scalar_one_or_none()
    if enrichment and enrichment.connection_sentence:
        snippet += f"\n\nConnection: {enrichment.connection_sentence}"

    return snippet[:_MAX_ANCHOR_SNIPPET_CHARS]


async def _load_anchor_chunks(
    db: AsyncSession,
    user_id: str,
    *,
    content_id: str | None,
    digest_item_id: str | None,
    query: str = "",
    query_embedding: list[float] | None = None,
    embedder=None,
) -> list[ContextChunk]:
    digest_item = None
    if digest_item_id:
        result = await db.execute(
            select(DigestItem)
            .join(Digest, DigestItem.digest_id == Digest.id)
            .where(DigestItem.id == digest_item_id, Digest.user_id == user_id)
        )
        digest_item = result.scalar_one_or_none()
        if digest_item and not content_id and digest_item.content_id:
            content_id = digest_item.content_id

    if content_id:
        raw = await db.execute(
            select(RawContent)
            .options(selectinload(RawContent.source))
            .where(RawContent.id == content_id, RawContent.user_id == user_id)
        )
        row = raw.scalar_one_or_none()
        if row:
            meta = row.meta or {}
            kind = "brain_dump" if meta.get("brain_dump") else "article"
            if digest_item:
                kind = "brief_anchor"
            source_name = row.source.name if row.source else None
            title = (digest_item.headline if digest_item else None) or row.title or "Untitled"
            url = (digest_item.source_url if digest_item else None) or row.url
            if digest_item and digest_item.source_name:
                source_name = digest_item.source_name

            digest_blurb = None
            if digest_item:
                digest_blurb = (
                    f"Briefing summary: {digest_item.summary}\n"
                    f"Why it matters: {digest_item.why_it_matters}"
                )[:800]

            snippet = await _article_snippet_for_query(
                db,
                user_id,
                row,
                query=query,
                query_embedding=query_embedding if embedder else None,
                embedder=embedder,
                digest_blurb=digest_blurb,
            )
            return [
                ContextChunk(
                    ref="S1",
                    content_id=row.id,
                    title=title,
                    url=url,
                    source_name=source_name,
                    snippet=snippet,
                    kind=kind,
                )
            ]

    if digest_item:
        snippet = f"{digest_item.summary}\n\nWhy it matters: {digest_item.why_it_matters}"
        return [
            ContextChunk(
                ref="S1",
                content_id=digest_item.content_id or f"digest-item:{digest_item.id}",
                title=digest_item.headline,
                url=digest_item.source_url,
                source_name=digest_item.source_name,
                snippet=snippet[:1200],
                kind="brief_anchor",
            )
        ]

    return []


async def _semantic_retrieve(
    db: AsyncSession,
    user_id: str,
    query_embedding: list[float],
    *,
    exclude_ids: set[str],
    never_show: list[str],
    limit: int,
    min_similarity: float = _MIN_SIMILARITY,
) -> list[ContextChunk]:
    max_distance = 1.0 - min_similarity
    distance_expr = ContentEmbedding.embedding.cosine_distance(query_embedding)

    stmt = (
        select(ContentEmbedding, RawContent, distance_expr.label("distance"))
        .join(RawContent, ContentEmbedding.content_id == RawContent.id)
        .where(RawContent.user_id == user_id)
        .where(distance_expr <= max_distance)
    )
    if exclude_ids:
        stmt = stmt.where(ContentEmbedding.content_id.notin_(list(exclude_ids)))
    stmt = stmt.order_by(distance_expr).limit(max(limit * 3, _MAX_CHUNKS))

    result = await db.execute(stmt)
    rows = result.all()

    chunks: list[ContextChunk] = []
    for emb, raw, _distance in rows:
        if len(chunks) >= limit:
            break
        content_id = emb.content_id
        title = raw.title or "Untitled"
        snippet = (raw.summary or raw.clean_text or "")[:900]
        blob = f"{title} {snippet}"
        if _never_show_block(blob, never_show):
            continue
        meta = raw.meta or {}
        kind = "brain_dump" if meta.get("brain_dump") else "article"
        source_name = None
        if raw.source_id:
            src = await db.get(Source, raw.source_id)
            source_name = src.name if src else None
        enrich = await db.execute(
            select(ContentEnrichmentCache).where(
                ContentEnrichmentCache.user_id == user_id,
                ContentEnrichmentCache.content_id == content_id,
            )
        )
        enrichment = enrich.scalar_one_or_none()
        if enrichment and enrichment.why_relevant:
            snippet += f"\n\nWhy relevant: {enrichment.why_relevant}"
        chunks.append(
            ContextChunk(
                ref="",
                content_id=content_id,
                title=title,
                url=raw.url,
                source_name=source_name,
                snippet=snippet,
                kind=kind,
            )
        )
    return chunks


async def _raw_to_context_chunk(
    db: AsyncSession,
    user_id: str,
    raw: RawContent,
    *,
    never_show: list[str],
) -> ContextChunk | None:
    title = raw.title or "Untitled"
    snippet = (raw.summary or raw.clean_text or "")[:900]
    blob = f"{title} {snippet}"
    if _never_show_block(blob, never_show):
        return None
    meta = raw.meta or {}
    kind = "brain_dump" if meta.get("brain_dump") else "article"
    source_name = None
    if raw.source_id:
        src = await db.get(Source, raw.source_id)
        source_name = src.name if src else None
    enrich = await db.execute(
        select(ContentEnrichmentCache).where(
            ContentEnrichmentCache.user_id == user_id,
            ContentEnrichmentCache.content_id == raw.id,
        )
    )
    enrichment = enrich.scalar_one_or_none()
    if enrichment and enrichment.why_relevant:
        snippet += f"\n\nWhy relevant: {enrichment.why_relevant}"
    return ContextChunk(
        ref="",
        content_id=raw.id,
        title=title,
        url=raw.url,
        source_name=source_name,
        snippet=snippet,
        kind=kind,
    )


async def _retrieve_library_by_keywords(
    db: AsyncSession,
    user_id: str,
    terms: list[str],
    *,
    never_show: list[str],
    limit: int,
    exclude_ids: set[str] | None = None,
) -> list[ContextChunk]:
    """Title/summary keyword fallback when embeddings miss relevant articles."""
    if not terms:
        return []
    exclude = exclude_ids or set()
    stmt = (
        select(RawContent)
        .where(RawContent.user_id == user_id)
        .order_by(RawContent.ingested_at.desc())
        .limit(max(limit * 8, 40))
    )
    rows = (await db.execute(stmt)).scalars().all()
    scored: list[tuple[int, RawContent]] = []
    for raw in rows:
        if raw.id in exclude:
            continue
        hay = f"{raw.title or ''} {raw.summary or ''} {raw.clean_text or ''}".lower()
        hits = sum(1 for t in terms if t in hay)
        if hits:
            scored.append((hits, raw))
    scored.sort(key=lambda x: x[0], reverse=True)
    chunks: list[ContextChunk] = []
    for _, raw in scored[:limit]:
        chunk = await _raw_to_context_chunk(db, user_id, raw, never_show=never_show)
        if chunk:
            chunks.append(chunk)
    return chunks


async def _retrieve_recent_library(
    db: AsyncSession,
    user_id: str,
    *,
    never_show: list[str],
    limit: int,
    exclude_ids: set[str] | None = None,
) -> list[ContextChunk]:
    """Recent saved content when semantic/keyword retrieval returns nothing."""
    exclude = exclude_ids or set()
    stmt = (
        select(RawContent)
        .where(RawContent.user_id == user_id)
        .order_by(RawContent.ingested_at.desc())
        .limit(max(limit * 3, 24))
    )
    rows = (await db.execute(stmt)).scalars().all()
    chunks: list[ContextChunk] = []
    for raw in rows:
        if raw.id in exclude or len(chunks) >= limit:
            continue
        chunk = await _raw_to_context_chunk(db, user_id, raw, never_show=never_show)
        if chunk:
            chunks.append(chunk)
    return chunks


async def _retrieve_corpus_library(
    db: AsyncSession,
    user_id: str,
    message: str,
    query_embedding: list[float],
    *,
    never_show: list[str],
    limit: int = _MAX_CORPUS_CHUNKS,
) -> list[ContextChunk]:
    """Wide retrieval for questions about the user's overall article library."""
    semantic = await _semantic_retrieve(
        db,
        user_id,
        query_embedding,
        exclude_ids=set(),
        never_show=never_show,
        limit=limit,
        min_similarity=_MIN_CORPUS_SIMILARITY,
    )
    if len(semantic) >= max(4, limit // 2):
        return semantic

    terms = extract_topic_terms(message)
    keyword = await _retrieve_library_by_keywords(
        db,
        user_id,
        terms,
        never_show=never_show,
        limit=limit,
        exclude_ids={c.content_id for c in semantic},
    )
    merged = semantic + keyword
    if merged:
        return merged[:limit]

    recent = await _retrieve_recent_library(
        db,
        user_id,
        never_show=never_show,
        limit=limit,
        exclude_ids={c.content_id for c in merged},
    )
    return recent[:limit]


def _assign_refs(chunks: list[ContextChunk], start_index: int = 1) -> list[ContextChunk]:
    out: list[ContextChunk] = []
    for i, c in enumerate(chunks):
        out.append(
            ContextChunk(
                ref=f"S{start_index + i}",
                content_id=c.content_id,
                title=c.title,
                url=c.url,
                source_name=c.source_name,
                snippet=c.snippet,
                kind=c.kind,
            )
        )
    return out


def _format_context_pack(chunks: list[ContextChunk]) -> str:
    parts: list[str] = []
    for c in chunks:
        parts.append(
            f"[{c.ref}] {c.title}\n"
            f"Source: {c.source_name or 'Unknown'} | Type: {c.kind}\n"
            f"URL: {c.url or 'n/a'}\n"
            f"{c.snippet}\n"
        )
    return "\n---\n".join(parts)


def _chunk_to_citation(chunk: ContextChunk) -> dict:
    return {
        "ref": chunk.ref,
        "content_id": chunk.content_id or "",
        "title": chunk.title,
        "url": chunk.url,
        "source_name": chunk.source_name,
        "snippet": chunk.snippet[:280],
        "kind": chunk.kind,
    }


def _extract_citations(answer: str, chunks: list[ContextChunk]) -> list[dict]:
    refs_used = {f"S{m.group(1)}" for m in _CITATION_RE.finditer(answer)}
    by_ref = {c.ref: c for c in chunks if c.ref}
    # If the model omits inline [S1] markers, still surface the context pack as sources.
    if not refs_used:
        refs_used = set(by_ref.keys())
    citations: list[dict] = []
    for ref in sorted(refs_used, key=lambda r: int(r[1:])):
        chunk = by_ref.get(ref)
        if not chunk:
            continue
        citations.append(_chunk_to_citation(chunk))
    return citations


_ASK_SYSTEM = """You are Briefly — the user's chief-of-staff for their personal knowledge base.

You answer using ONLY the sources in the context pack, labeled [S1], [S2], etc.
- Cite sources inline like [S1] when you use them.
- If the sources don't contain enough information, say so honestly. Do not invent articles or URLs.
- When excerpts from a focused article are provided, extract concrete facts (names, numbers, lists, dates) directly from those excerpts before saying information is missing.
- When CONVERSATION FOCUS is set, follow-up questions like "this article", "it", or "what does it say about X" refer to that focused article. Answer from [S1] unless the user clearly names a different source.
- Be concise, direct, and personal (use what you know about the user from the profile).
- Connect dots across sources when relevant.
- Decision timeline sources are the user's own dated record. Distinguish a recorded belief, an assessed signal, and a founder-confirmed outcome; never imply that an assessment was an action.
- Never mention that you are an AI or language model.
- Never tell the user to check external apps (Reader, email, etc.) — Briefly IS their reading system.
- When the pack is a SAVED/UNREAD INDEX, list each item by title with a short note on why it's unread. If the index is empty, say their saved queue is clear.
- When the pack is a TODAY BRIEF INDEX, summarize today's briefing items first. If empty, clearly say today's briefing is not ready yet.
- When the pack is a LIBRARY INDEX, the user is asking about their saved articles/content overall. Summarize the most relevant items from the pack (2–5 for voice) with title and one concrete detail each. If the pack lists recent library items but none match the topic, say what you found and note the closest matches.
- If the pack says there are no matching sources, tell the user honestly and suggest they save or ingest content on that topic."""


def _is_referential_followup(message: str) -> bool:
    return bool(_REFERENTIAL_FOLLOWUP.search(message))


def is_vague_continuation(message: str) -> bool:
    """Short follow-ups that refer to the prior turn without naming the topic."""
    text = (message or "").strip()
    if not text or len(text.split()) > 14:
        return False
    if is_corpus_library_query(text) or is_today_brief_query(text) or is_saved_unread_query(text):
        return False
    return bool(_VAGUE_CONTINUATION_RE.search(text))


def _prior_user_question(history: list[dict]) -> str:
    for msg in reversed(history):
        if msg.get("role") != "user":
            continue
        content = str(msg.get("content") or "").strip()
        if content and len(content.split()) >= 3:
            return content
    return ""


def _resolve_retrieval_query(message: str, thread: FollowUpThread | None) -> str:
    """Expand elliptical follow-ups so RAG search stays on the active topic."""
    text = (message or "").strip()
    if not is_vague_continuation(text):
        return text
    history = list(thread.messages or []) if thread else []
    prior = _prior_user_question(history)
    if prior:
        return f"{prior} {text}".strip()
    return text


def _infer_content_id_from_messages(messages: list[dict]) -> str | None:
    for msg in reversed(messages):
        if msg.get("role") != "assistant":
            continue
        for cite in msg.get("citations") or []:
            cid = cite.get("content_id")
            if cid and not str(cid).startswith("digest-item"):
                return str(cid)
    return None


def _resolve_thread_anchor(
    thread: FollowUpThread | None,
    *,
    content_id: str | None,
    digest_item_id: str | None,
    message: str,
) -> tuple[str | None, str | None]:
    """Merge request scope with persisted thread scope and conversation history."""
    tid = digest_item_id
    cid = content_id

    if thread:
        if not tid and thread.digest_item_id:
            tid = thread.digest_item_id
        if not cid and getattr(thread, "content_id", None):
            cid = thread.content_id

    history = list(thread.messages or []) if thread else []
    if not cid and not tid and history and _is_referential_followup(message):
        cid = _infer_content_id_from_messages(history)

    # Keep multi-turn threads on the last cited article when scope was never stored,
    # unless the user is asking across their whole library (not one article).
    if (
        not cid
        and not tid
        and history
        and len(history) >= 2
        and not is_corpus_library_query(message)
    ):
        cid = _infer_content_id_from_messages(history)

    return cid, tid


def _sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _prepare_ask(
    db: AsyncSession,
    user: User,
    message: str,
    *,
    thread_id: str | None = None,
    content_id: str | None = None,
    digest_item_id: str | None = None,
) -> AskPrepared:
    profile = user.profile
    never_show = list(profile.never_show or []) if profile else []

    thread: FollowUpThread | None = None
    if thread_id:
        result = await db.execute(
            select(FollowUpThread).where(
                FollowUpThread.id == thread_id,
                FollowUpThread.user_id == user.id,
            )
        )
        thread = result.scalar_one_or_none()
        if not thread:
            raise ValueError("Thread not found.")

    if not thread:
        thread = FollowUpThread(
            user_id=user.id,
            digest_id=None,
            digest_item_id=digest_item_id,
            content_id=content_id,
            messages=[],
        )
        db.add(thread)
        await db.flush()

    content_id, digest_item_id = _resolve_thread_anchor(
        thread,
        content_id=content_id,
        digest_item_id=digest_item_id,
        message=message,
    )

    retrieval_query = _resolve_retrieval_query(message, thread)
    continuation = is_vague_continuation(message) and bool(thread and thread.messages)

    if digest_item_id and not thread.digest_item_id:
        thread.digest_item_id = digest_item_id
    if content_id and not thread.content_id:
        thread.content_id = content_id

    focused = bool(content_id or digest_item_id)
    focus_title: str | None = None

    today_brief_mode = is_today_brief_query(message) and not content_id and not digest_item_id
    saved_unread_mode = is_saved_unread_query(message) and not content_id and not digest_item_id
    corpus_library_mode = is_corpus_library_query(message) and not content_id and not digest_item_id

    if today_brief_mode:
        today_chunks = await _retrieve_today_brief(db, user.id, never_show=never_show)
        all_chunks = _assign_refs(today_chunks, start_index=1)
        if all_chunks:
            context_pack = "TODAY BRIEF INDEX:\n" + _format_context_pack(all_chunks)
        else:
            context_pack = (
                "TODAY BRIEF INDEX: No briefing is ready for today yet. "
                "Tell the user the brief may still be generating."
            )
    elif saved_unread_mode:
        saved_chunks = await _retrieve_saved_unread(db, user.id, never_show=never_show)
        all_chunks = _assign_refs(saved_chunks, start_index=1)
        if all_chunks:
            context_pack = "SAVED/UNREAD INDEX:\n" + _format_context_pack(all_chunks)
        else:
            context_pack = (
                "SAVED/UNREAD INDEX: No saved-but-unread items in Briefly right now "
                "(no starred briefing items awaiting open, no queued browser saves)."
            )
    elif corpus_library_mode:
        embedder = get_embedding_adapter()
        query_embedding = await embedder.embed(retrieval_query)
        library_chunks = await _retrieve_corpus_library(
            db,
            user.id,
            message,
            query_embedding,
            never_show=never_show,
        )
        all_chunks = _assign_refs(library_chunks, start_index=1)
        if all_chunks:
            context_pack = (
                "LIBRARY INDEX (saved articles & content in the user's Briefly library):\n"
                + _format_context_pack(all_chunks)
            )
        else:
            context_pack = (
                "LIBRARY INDEX: The user has no saved articles or content in Briefly yet. "
                "Tell them honestly and suggest saving articles or connecting sources."
            )
    else:
        embedder = get_embedding_adapter()
        query_embedding = await embedder.embed(retrieval_query)

        anchor_chunks = await _load_anchor_chunks(
            db,
            user.id,
            content_id=content_id,
            digest_item_id=digest_item_id,
            query=retrieval_query,
            query_embedding=query_embedding,
            embedder=embedder,
        )
        if anchor_chunks:
            focus_title = anchor_chunks[0].title

        from briefly_api.services.decisions.retrieval import retrieve_decision_chunks

        decision_chunks = await retrieve_decision_chunks(
            db, user.id, retrieval_query, limit=3
        )
        extra: list[ContextChunk] = []
        if not focused:
            exclude = {c.content_id for c in anchor_chunks if not c.content_id.startswith("digest-item")}
            extra_limit = _MAX_CHUNKS - len(anchor_chunks) - len(decision_chunks)
            if extra_limit > 0:
                extra = await _semantic_retrieve(
                    db,
                    user.id,
                    query_embedding,
                    exclude_ids=exclude,
                    never_show=never_show,
                    limit=extra_limit,
                )

        all_chunks = _assign_refs(anchor_chunks + decision_chunks + extra, start_index=1)
        context_pack = _format_context_pack(all_chunks) if all_chunks else "(No matching sources in your library yet.)"
        if focused and focus_title:
            context_pack = (
                f"CONVERSATION FOCUS: Stay on \"{focus_title}\" ([S1]) unless the user "
                f"explicitly asks about a different article.\n\n{context_pack}"
            )

    profile_text = _profile_blurb(profile)
    try:
        from briefly_api.services.decisions.threads import (
            format_threads_for_prompt,
            list_threads as list_decision_threads,
        )

        threads = await list_decision_threads(db, user.id)
        block = format_threads_for_prompt(threads)
        if block:
            profile_text = f"{profile_text}\n\n{block}"
    except Exception:
        pass

    history = list(thread.messages or [])[-_MAX_HISTORY:]
    llm_messages: list[Message] = []
    for msg in history:
        role = msg.get("role")
        content = msg.get("content")
        if role in ("user", "assistant") and isinstance(content, str):
            llm_messages.append(Message(role=role, content=content))

    user_prompt = (
        f"USER PROFILE:\n{profile_text}\n\n"
        f"SOURCE PACK:\n{context_pack}\n\n"
    )
    if continuation:
        user_prompt += (
            "CONTINUATION: The user is asking for more detail on the same topic as the "
            "conversation above. Expand on your previous answer — do NOT explain what "
            "'more details' means or ask them to clarify the phrase.\n\n"
        )
    user_prompt += f"USER QUESTION:\n{message.strip()}"
    llm_messages.append(Message(role="user", content=user_prompt))

    return AskPrepared(
        thread=thread,
        message=message.strip(),
        all_chunks=all_chunks,
        llm_messages=llm_messages,
        digest_item_id=digest_item_id,
        content_id=content_id,
        user_id=user.id,
        focused=focused,
        focus_title=focus_title,
    )


async def _persist_ask_response(
    db: AsyncSession,
    prepared: AskPrepared,
    answer: str,
    citations: list[dict],
) -> str:
    return await _persist_ask_snapshot(
        db,
        _ask_persist_snapshot(prepared),
        answer,
        citations,
    )


async def _persist_ask_snapshot(
    db: AsyncSession,
    snapshot: _AskPersistSnapshot,
    answer: str,
    citations: list[dict],
) -> str:
    now = datetime.now(timezone.utc).isoformat()
    result = await db.execute(
        select(FollowUpThread).where(
            FollowUpThread.id == snapshot.thread_id,
            FollowUpThread.user_id == snapshot.user_id,
        )
    )
    thread = result.scalar_one_or_none()
    if not thread:
        raise ValueError("Thread not found.")

    thread.messages = list(snapshot.prior_messages) + [
        {"role": "user", "content": snapshot.message, "timestamp": now},
        {
            "role": "assistant",
            "content": answer,
            "citations": citations,
            "timestamp": now,
        },
    ]

    if not thread.content_id and snapshot.content_id:
        thread.content_id = snapshot.content_id
    elif (
        not thread.content_id
        and not thread.digest_item_id
        and citations
    ):
        primary = citations[0].get("content_id")
        if primary and not str(primary).startswith("digest-item"):
            thread.content_id = str(primary)

    if snapshot.digest_item_id:
        item_result = await db.execute(
            select(DigestItem)
            .join(Digest, DigestItem.digest_id == Digest.id)
            .where(
                DigestItem.id == snapshot.digest_item_id,
                Digest.user_id == snapshot.user_id,
            )
        )
        item = item_result.scalar_one_or_none()
        if item:
            item.had_follow_up = True
            item.follow_up_depth = (item.follow_up_depth or 0) + 1
            db.add(
                BehavioralSignal(
                    user_id=snapshot.user_id,
                    signal_type=SignalType.followed_up,
                    digest_id=item.digest_id,
                    digest_item_id=item.id,
                    meta={"via": "ask_briefly"},
                )
            )

    await db.commit()
    await db.refresh(thread)
    return now


async def ask_briefly(
    db: AsyncSession,
    user: User,
    message: str,
    *,
    thread_id: str | None = None,
    content_id: str | None = None,
    digest_item_id: str | None = None,
    voice: bool = False,
) -> dict:
    prepared = await _prepare_ask(
        db,
        user,
        message,
        thread_id=thread_id,
        content_id=content_id,
        digest_item_id=digest_item_id,
    )

    system = _ASK_SYSTEM
    max_tokens = 1200
    corpus_mode = is_corpus_library_query(message)
    if voice:
        from briefly_api.services.orb_persona import VOICE_CONVERSATION_SUFFIX

        system = (
            f"{_ASK_SYSTEM}\n\n"
            "VOICE MODE: Reply in 2–5 short spoken sentences unless the user explicitly "
            "asked for detail. No markdown, headings, or bullet lists — natural speech only."
            f"{VOICE_CONVERSATION_SUFFIX}\n\n"
            "VOICE ACTIONS: You cannot compose reports or send emails yourself in this mode. "
            "If the user asks to write/create a report, read a report aloud, draft an email, "
            "or send mail, tell them Briefly can do that — ask them to repeat the request clearly "
            "(e.g. 'write a report on X', 'email this report', 'read it aloud'). Do NOT say "
            "you are unable or that the feature does not exist."
        )
        if corpus_mode:
            system += (
                "\n\nVOICE LIBRARY MODE: When listing articles from the library, name 2–4 "
                "specific titles with one brief detail each, grounded in the source pack."
            )
        history = [
            m for m in prepared.llm_messages
            if m.role in ("user", "assistant")
        ]
        if len(history) > 1:
            system += (
                "\n\nVOICE FOLLOW-UP: The user is continuing a spoken conversation in this "
                "thread. Treat their new question as referring to your immediately prior answer "
                "and the same topic unless they clearly change subject. If they ask for 'more "
                "details', 'tell me more', or similar, give deeper information on that same "
                "topic — never define their request or explain what the phrase means."
            )
        if is_vague_continuation(message) and len(history) > 1:
            system += (
                "\n\nVOICE CONTINUATION: Answer as a direct extension of your last response. "
                "Use the source pack and your prior answer together. Give a fuller answer "
                "(several sentences) since they explicitly asked for more detail."
            )
        if corpus_mode:
            max_tokens = 520
        elif is_vague_continuation(message) and len(history) > 1:
            max_tokens = 900
        else:
            max_tokens = 480

    llm = get_llm_adapter()
    response = await llm.complete(
        prepared.llm_messages,
        system=system,
        temperature=0.35,
        max_tokens=max_tokens,
        user_id=user.id,
        agent="ask_briefly",
    )
    answer = response.content.strip()
    citations = _extract_citations(answer, prepared.all_chunks)
    now = await _persist_ask_response(db, prepared, answer, citations)

    return {
        "thread_id": prepared.thread.id,
        "assistant": {
            "role": "assistant",
            "content": answer,
            "citations": citations,
            "created_at": now,
        },
    }


async def iter_ask_briefly_events(
    db: AsyncSession | None,
    user: User,
    message: str,
    *,
    thread_id: str | None = None,
    content_id: str | None = None,
    digest_item_id: str | None = None,
    voice: bool = False,
) -> AsyncIterator[dict]:
    """Yield structured events for streaming ask turns (SSE + WebSocket)."""
    user_id = str(user.id)
    async with SessionLocal() as prep_db:
        prep_user = await _load_user_for_ask(prep_db, user_id)
        prepared = await _prepare_ask(
            prep_db,
            prep_user,
            message,
            thread_id=thread_id,
            content_id=content_id,
            digest_item_id=digest_item_id,
        )
        await prep_db.commit()
    snapshot = _ask_persist_snapshot(prepared)

    system = _ASK_SYSTEM
    max_tokens = 1200
    history = list(snapshot.prior_messages)
    corpus_mode = is_corpus_library_query(message)
    if voice:
        from briefly_api.services.orb_persona import VOICE_CONVERSATION_SUFFIX

        system = (
            f"{_ASK_SYSTEM}\n\n"
            "VOICE MODE: Reply in 2–5 short spoken sentences unless the user explicitly "
            "asked for detail. No markdown, headings, or bullet lists — natural speech only."
            f"{VOICE_CONVERSATION_SUFFIX}\n\n"
            "VOICE ACTIONS: You cannot compose reports or send emails yourself in this mode. "
            "If the user asks to write/create a report, read a report aloud, draft an email, "
            "or send mail, tell them Briefly can do that — ask them to repeat the request clearly "
            "(e.g. 'write a report on X', 'email this report', 'read it aloud'). Do NOT say "
            "you are unable or that the feature does not exist."
        )
        if corpus_mode:
            system += (
                "\n\nVOICE LIBRARY MODE: When listing articles from the library, name 2–4 "
                "specific titles with one brief detail each, grounded in the source pack."
            )
        if history:
            system += (
                "\n\nVOICE FOLLOW-UP: The user is continuing a spoken conversation in this "
                "thread. Treat their new question as referring to your immediately prior answer "
                "and the same topic unless they clearly change subject. If they ask for 'more "
                "details', 'tell me more', or similar, give deeper information on that same "
                "topic — never define their request or explain what the phrase means."
            )
        if is_vague_continuation(message) and history:
            system += (
                "\n\nVOICE CONTINUATION: Answer as a direct extension of your last response. "
                "Use the source pack and your prior answer together. Give a fuller answer "
                "(several sentences) since they explicitly asked for more detail."
            )
        if corpus_mode:
            max_tokens = 520
        elif is_vague_continuation(message) and history:
            max_tokens = 900
        else:
            max_tokens = 480

    yield {"type": "thread_id", "thread_id": snapshot.thread_id}

    llm = get_llm_adapter()
    parts: list[str] = []
    try:
        async for delta in llm.stream_complete(
            prepared.llm_messages,
            system=system,
            temperature=0.35,
            max_tokens=max_tokens,
            user_id=user_id,
            agent="ask_briefly",
        ):
            parts.append(delta)
            yield {"type": "delta", "content": delta}
    except asyncio.CancelledError:
        raise

    answer = "".join(parts).strip()
    citations = _extract_citations(answer, prepared.all_chunks)
    async with SessionLocal() as persist_db:
        created_at = await _persist_ask_snapshot(persist_db, snapshot, answer, citations)
    yield {
        "type": "done",
        "answer": answer,
        "citations": citations,
        "created_at": created_at,
        "content_id": snapshot.thread_content_id or snapshot.content_id,
        "digest_item_id": snapshot.thread_digest_item_id or snapshot.digest_item_id,
        "anchor_title": prepared.focus_title,
    }


async def stream_ask_briefly(
    db: AsyncSession,
    user: User,
    message: str,
    *,
    thread_id: str | None = None,
    content_id: str | None = None,
    digest_item_id: str | None = None,
    voice: bool = False,
) -> AsyncIterator[str]:
    async for event in iter_ask_briefly_events(
        db,
        user,
        message,
        thread_id=thread_id,
        content_id=content_id,
        digest_item_id=digest_item_id,
        voice=voice,
    ):
        yield _sse_event(event)


async def list_threads(db: AsyncSession, user_id: str, *, limit: int = 30) -> list[dict]:
    result = await db.execute(
        select(FollowUpThread)
        .where(FollowUpThread.user_id == user_id)
        .order_by(FollowUpThread.updated_at.desc())
        .limit(limit)
    )
    threads = result.scalars().all()
    item_ids = [t.digest_item_id for t in threads if t.digest_item_id]
    items_by_id: dict[str, DigestItem] = {}
    if item_ids:
        items_result = await db.execute(
            select(DigestItem).where(DigestItem.id.in_(item_ids))
        )
        items_by_id = {i.id: i for i in items_result.scalars().all()}

    out: list[dict] = []
    for t in threads:
        msgs = t.messages or []
        preview = ""
        title = "Ask Briefly"
        for m in reversed(msgs):
            if m.get("role") == "user" and m.get("content"):
                preview = str(m["content"])[:120]
                title = str(m["content"])[:80]
                break
        anchor = items_by_id.get(t.digest_item_id) if t.digest_item_id else None
        thread_content_id = getattr(t, "content_id", None) or (anchor.content_id if anchor else None)
        anchor_title = anchor.headline if anchor else None
        if not anchor_title and thread_content_id:
            raw = await db.get(RawContent, thread_content_id)
            if raw and raw.title:
                anchor_title = raw.title
        if anchor_title:
            title = f"Re: {anchor_title[:72]}"
        out.append(
            {
                "id": t.id,
                "title": title,
                "preview": preview,
                "digest_item_id": t.digest_item_id,
                "content_id": thread_content_id,
                "anchor_title": anchor_title,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
                "message_count": len(msgs),
            }
        )
    return out


async def delete_thread(db: AsyncSession, user_id: str, thread_id: str) -> bool:
    result = await db.execute(
        select(FollowUpThread).where(
            FollowUpThread.id == thread_id,
            FollowUpThread.user_id == user_id,
        )
    )
    thread = result.scalar_one_or_none()
    if not thread:
        return False
    await db.delete(thread)
    await db.commit()
    return True


async def get_thread(db: AsyncSession, user_id: str, thread_id: str) -> dict | None:
    result = await db.execute(
        select(FollowUpThread).where(
            FollowUpThread.id == thread_id,
            FollowUpThread.user_id == user_id,
        )
    )
    thread = result.scalar_one_or_none()
    if not thread:
        return None
    anchor_title: str | None = None
    anchor_content_id = thread.content_id
    if thread.digest_item_id:
        item = await db.get(DigestItem, thread.digest_item_id)
        if item:
            anchor_title = item.headline
            if not anchor_content_id:
                anchor_content_id = item.content_id
    if not anchor_title and anchor_content_id:
        raw = await db.get(RawContent, anchor_content_id)
        if raw and raw.title:
            anchor_title = raw.title
    return {
        "id": thread.id,
        "digest_item_id": thread.digest_item_id,
        "content_id": anchor_content_id,
        "anchor_title": anchor_title,
        "messages": thread.messages or [],
        "created_at": thread.created_at.isoformat() if thread.created_at else None,
        "updated_at": thread.updated_at.isoformat() if thread.updated_at else None,
    }
