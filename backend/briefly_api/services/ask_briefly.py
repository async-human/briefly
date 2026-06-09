"""
Ask Briefly — RAG chat over the user's personal corpus.

Retrieves from ContentEmbedding + enrichment cache, answers with citations,
persists to FollowUpThread.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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
from briefly_api.services.profile_utils import cluster_label, iter_topic_clusters

_CITATION_RE = re.compile(r"\[S(\d+)\]")
_MAX_HISTORY = 8
_MAX_RETRIEVAL_POOL = 250
_MAX_CHUNKS = 8
_MIN_SIMILARITY = 0.32


@dataclass
class ContextChunk:
    ref: str
    content_id: str
    title: str
    url: str | None
    source_name: str | None
    snippet: str
    kind: str  # article | brain_dump | brief_anchor


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


async def _load_anchor_chunks(
    db: AsyncSession,
    user_id: str,
    *,
    content_id: str | None,
    digest_item_id: str | None,
) -> list[ContextChunk]:
    chunks: list[ContextChunk] = []

    if digest_item_id:
        result = await db.execute(
            select(DigestItem)
            .join(Digest, DigestItem.digest_id == Digest.id)
            .where(DigestItem.id == digest_item_id, Digest.user_id == user_id)
        )
        item = result.scalar_one_or_none()
        if item:
            snippet = f"{item.summary}\n\nWhy it matters: {item.why_it_matters}"
            cid = item.content_id or f"digest-item:{item.id}"
            kind = "brief_anchor"
            if item.content_id:
                raw = await db.get(RawContent, item.content_id)
                if raw and (raw.meta or {}).get("brain_dump"):
                    kind = "brain_dump"
            chunks.append(
                ContextChunk(
                    ref="S1",
                    content_id=cid if not cid.startswith("digest-item:") else item.content_id or item.id,
                    title=item.headline,
                    url=item.source_url,
                    source_name=item.source_name,
                    snippet=snippet[:1200],
                    kind=kind,
                )
            )
            if not content_id and item.content_id:
                content_id = item.content_id

    if content_id and not any(c.content_id == content_id for c in chunks):
        raw = await db.execute(
            select(RawContent)
            .options(selectinload(RawContent.source))
            .where(RawContent.id == content_id, RawContent.user_id == user_id)
        )
        row = raw.scalar_one_or_none()
        if row:
            meta = row.meta or {}
            kind = "brain_dump" if meta.get("brain_dump") else "article"
            source_name = row.source.name if row.source else None
            snippet = (row.summary or row.clean_text or "")[:1200]
            enrich = await db.execute(
                select(ContentEnrichmentCache).where(
                    ContentEnrichmentCache.user_id == user_id,
                    ContentEnrichmentCache.content_id == row.id,
                )
            )
            enrichment = enrich.scalar_one_or_none()
            if enrichment and enrichment.connection_sentence:
                snippet += f"\n\nConnection: {enrichment.connection_sentence}"
            chunks.append(
                ContextChunk(
                    ref="S1",
                    content_id=row.id,
                    title=row.title or "Untitled",
                    url=row.url,
                    source_name=source_name,
                    snippet=snippet,
                    kind=kind,
                )
            )

    return chunks


async def _semantic_retrieve(
    db: AsyncSession,
    user_id: str,
    query_embedding: list[float],
    *,
    exclude_ids: set[str],
    never_show: list[str],
    limit: int,
) -> list[ContextChunk]:
    result = await db.execute(
        select(ContentEmbedding, RawContent)
        .join(RawContent, ContentEmbedding.content_id == RawContent.id)
        .where(RawContent.user_id == user_id)
        .order_by(RawContent.ingested_at.desc())
        .limit(_MAX_RETRIEVAL_POOL)
    )
    rows = result.all()
    candidates: list[tuple[str, list[float]]] = []
    raw_by_id: dict[str, RawContent] = {}
    for emb, raw in rows:
        candidates.append((emb.content_id, emb.embedding))
        raw_by_id[emb.content_id] = raw

    ranked = rank_by_similarity(
        query_embedding, candidates, limit=limit, exclude_ids=exclude_ids
    )

    chunks: list[ContextChunk] = []
    for content_id, _sim in ranked:
        raw = raw_by_id.get(content_id)
        if not raw:
            continue
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


def _extract_citations(answer: str, chunks: list[ContextChunk]) -> list[dict]:
    refs_used = {f"S{m.group(1)}" for m in _CITATION_RE.finditer(answer)}
    by_ref = {c.ref: c for c in chunks}
    citations: list[dict] = []
    for ref in sorted(refs_used, key=lambda r: int(r[1:])):
        chunk = by_ref.get(ref)
        if not chunk:
            continue
        citations.append(
            {
                "ref": ref,
                "content_id": chunk.content_id,
                "title": chunk.title,
                "url": chunk.url,
                "source_name": chunk.source_name,
                "snippet": chunk.snippet[:280],
                "kind": chunk.kind,
            }
        )
    return citations


_ASK_SYSTEM = """You are Briefly — the user's chief-of-staff for their personal knowledge base.

You answer using ONLY the sources in the context pack, labeled [S1], [S2], etc.
- Cite sources inline like [S1] when you use them.
- If the sources don't contain enough information, say so honestly. Do not invent articles or URLs.
- Be concise, direct, and personal (use what you know about the user from the profile).
- Connect dots across sources when relevant.
- Never mention that you are an AI or language model."""


async def ask_briefly(
    db: AsyncSession,
    user: User,
    message: str,
    *,
    thread_id: str | None = None,
    content_id: str | None = None,
    digest_item_id: str | None = None,
) -> dict:
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
            messages=[],
        )
        db.add(thread)
        await db.flush()

    if digest_item_id and not thread.digest_item_id:
        thread.digest_item_id = digest_item_id

    embedder = get_embedding_adapter()
    query_embedding = await embedder.embed(message)

    anchor_chunks = await _load_anchor_chunks(
        db, user.id, content_id=content_id, digest_item_id=digest_item_id
    )
    exclude = {c.content_id for c in anchor_chunks if not c.content_id.startswith("digest-item")}
    extra_limit = _MAX_CHUNKS - len(anchor_chunks)
    extra: list[ContextChunk] = []
    if extra_limit > 0:
        extra = await _semantic_retrieve(
            db,
            user.id,
            query_embedding,
            exclude_ids=exclude,
            never_show=never_show,
            limit=extra_limit,
        )

    all_chunks = _assign_refs(anchor_chunks + extra, start_index=1)
    context_pack = _format_context_pack(all_chunks) if all_chunks else "(No matching sources in your library yet.)"
    profile_text = _profile_blurb(profile)

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
        f"USER QUESTION:\n{message.strip()}"
    )
    llm_messages.append(Message(role="user", content=user_prompt))

    llm = get_llm_adapter()
    response = await llm.complete(
        llm_messages,
        system=_ASK_SYSTEM,
        temperature=0.35,
        max_tokens=1200,
    )
    answer = response.content.strip()
    citations = _extract_citations(answer, all_chunks)

    now = datetime.now(timezone.utc).isoformat()
    thread.messages = list(thread.messages or []) + [
        {"role": "user", "content": message.strip(), "timestamp": now},
        {
            "role": "assistant",
            "content": answer,
            "citations": citations,
            "timestamp": now,
        },
    ]

    if digest_item_id:
        item_result = await db.execute(
            select(DigestItem)
            .join(Digest, DigestItem.digest_id == Digest.id)
            .where(DigestItem.id == digest_item_id, Digest.user_id == user.id)
        )
        item = item_result.scalar_one_or_none()
        if item:
            item.had_follow_up = True
            item.follow_up_depth = (item.follow_up_depth or 0) + 1
            db.add(
                BehavioralSignal(
                    user_id=user.id,
                    signal_type=SignalType.followed_up,
                    digest_id=item.digest_id,
                    digest_item_id=item.id,
                    meta={"via": "ask_briefly"},
                )
            )

    await db.commit()
    await db.refresh(thread)

    return {
        "thread_id": thread.id,
        "assistant": {
            "role": "assistant",
            "content": answer,
            "citations": citations,
            "created_at": now,
        },
    }


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
        if anchor and title == "Ask Briefly":
            title = f"Re: {anchor.headline[:72]}"
        out.append(
            {
                "id": t.id,
                "title": title,
                "preview": preview,
                "digest_item_id": t.digest_item_id,
                "content_id": anchor.content_id if anchor else None,
                "anchor_title": anchor.headline if anchor else None,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
                "message_count": len(msgs),
            }
        )
    return out


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
    anchor_content_id: str | None = None
    if thread.digest_item_id:
        item = await db.get(DigestItem, thread.digest_item_id)
        if item:
            anchor_title = item.headline
            anchor_content_id = item.content_id
    return {
        "id": thread.id,
        "digest_item_id": thread.digest_item_id,
        "content_id": anchor_content_id,
        "anchor_title": anchor_title,
        "messages": thread.messages or [],
        "created_at": thread.created_at.isoformat() if thread.created_at else None,
        "updated_at": thread.updated_at.isoformat() if thread.updated_at else None,
    }
