"""
briefly_api/services/brain_dump.py

Brain Dump pipeline: raw text or voice → STT (if audio) → LLM structure
→ RawContent + embedding + profile relevance update.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings, get_settings
from briefly_api.db.models import (
    ContentEmbedding,
    ContentStatus,
    RawContent,
    Source,
    SourceStatus,
    UserProfile,
)
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.stt.adapter import get_stt_adapter

log = logging.getLogger(__name__)

BRAIN_DUMP_SOURCE_TYPE = "brain_dump"
BRAIN_DUMP_IDENTIFIER = "personal"
BRAIN_DUMP_SECTION = "Your thoughts"
BRAIN_DUMP_SOURCE_LABEL = "Your brain dump"
_MAX_INJECT_PER_DIGEST = 3
_INJECT_MAX_AGE_HOURS = 48
_PROFILE_BLEND_ALPHA = 0.12

_STRUCTURE_SYSTEM = (
    "You are the cognitive parsing agent for Briefly. Take a raw, chaotic "
    "stream-of-consciousness brain dump, fix structural flow without changing "
    "technical intent, and extract actionable structural fields. "
    "Always add proper punctuation, capitalization, paragraph breaks, and "
    "bullet or numbered lists when the speaker enumerated items."
)

_STRUCTURE_PROMPT = """RAW USER BRAIN DUMP:
\"\"\"{raw_text}\"\"\"

Process this input and output a strict JSON object:
{{
  "title": "string",              // Short headline, max 80 chars
  "formatted_transcript": "string", // Full transcript with proper punctuation, paragraphs, and bullet/numbered lists where the speaker listed items. Preserve their exact meaning and wording — only fix structure and readability.
  "clean_summary": "string",      // Polished, readable summary of their thought
  "intent_type": "project_idea" | "action_item" | "general_context",
  "action_items": ["string"],     // Explicit tasks found; empty array if none
  "relevance_keywords": ["string"], // Top 3-5 keywords for relevance matching
  "should_inject_into_morning_brief": boolean
}}"""


@dataclass
class BrainDumpResult:
    id: str
    title: str
    clean_summary: str
    intent_type: str
    action_items: list[str]
    relevance_keywords: list[str]
    should_inject_into_morning_brief: bool
    raw_transcript: str
    input_mode: str  # "text" | "voice"
    created_at: datetime
    injected_at: datetime | None = None
    injected_digest_id: str | None = None


async def process_text_dump(
    db: AsyncSession,
    user_id: str,
    text: str,
    *,
    settings: Settings | None = None,
) -> BrainDumpResult:
    """Process a text brain dump."""
    raw = text.strip()
    if not raw:
        raise ValueError("Brain dump text cannot be empty.")
    if len(raw) > 50_000:
        raise ValueError("Brain dump exceeds 50,000 character limit.")

    structured = await _structure_dump(raw, settings)
    return await _persist_dump(
        db,
        user_id,
        raw_transcript=raw,
        structured=structured,
        input_mode="text",
        settings=settings,
    )


async def transcribe_audio_preview(
    audio_bytes: bytes,
    *,
    filename: str = "recording.webm",
    content_type: str = "audio/webm",
    settings: Settings | None = None,
) -> str:
    """Transcribe audio without persisting — used for live preview while recording."""
    if not audio_bytes or len(audio_bytes) < 800:
        return ""
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise ValueError("Audio file exceeds 25 MB limit.")

    stt = get_stt_adapter(settings)
    return await stt.transcribe(
        audio_bytes,
        filename=filename,
        content_type=content_type,
    )


async def process_audio_dump(
    db: AsyncSession,
    user_id: str,
    audio_bytes: bytes,
    *,
    filename: str = "recording.webm",
    content_type: str = "audio/webm",
    settings: Settings | None = None,
) -> BrainDumpResult:
    """Transcribe audio then process as a brain dump."""
    if not audio_bytes:
        raise ValueError("Audio file is empty.")
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise ValueError("Audio file exceeds 25 MB limit.")

    stt = get_stt_adapter(settings)
    transcript = await stt.transcribe(
        audio_bytes,
        filename=filename,
        content_type=content_type,
    )
    if not transcript.strip():
        raise ValueError("Could not transcribe any speech from the audio.")

    structured = await _structure_dump(transcript, settings)
    return await _persist_dump(
        db,
        user_id,
        raw_transcript=transcript,
        structured=structured,
        input_mode="voice",
        settings=settings,
        audio_meta={"filename": filename, "content_type": content_type, "size_bytes": len(audio_bytes)},
    )


async def get_pending_for_morning_brief(
    db: AsyncSession,
    user_id: str,
    *,
    limit: int = _MAX_INJECT_PER_DIGEST,
    max_age_hours: int = _INJECT_MAX_AGE_HOURS,
) -> list[BrainDumpResult]:
    """
    Brain dumps flagged for the morning brief that have not yet been injected.
    """
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

    pending: list[BrainDumpResult] = []
    for row in rows:
        meta = row.meta or {}
        if not meta.get("brain_dump"):
            continue
        if not meta.get("should_inject_into_morning_brief"):
            continue
        if meta.get("injected_at") or meta.get("injected_digest_id"):
            continue
        pending.append(_raw_to_result(row))
        if len(pending) >= limit:
            break

    return pending


def dumps_to_digest_items(dumps: list[BrainDumpResult]) -> list[dict]:
    """Convert pending brain dumps into digest item payloads (prepended to briefings)."""
    items: list[dict] = []
    for dump in dumps:
        items.append({
            "content_id": dump.id,
            "headline": dump.title,
            "summary": dump.clean_summary,
            "why_it_matters": why_it_matters_for_dump(dump),
            "source_name": BRAIN_DUMP_SOURCE_LABEL,
            "source_url": None,
            "section": BRAIN_DUMP_SECTION,
            "relevance_score": 1.0,
            "novelty_score": 1.0,
        })
    return items


async def mark_dumps_injected(
    db: AsyncSession,
    dump_ids: list[str],
    digest_id: str,
) -> None:
    """Record that these brain dumps were included in a digest."""
    if not dump_ids:
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.execute(
        select(RawContent).where(RawContent.id.in_(dump_ids))
    )
    for row in result.scalars().all():
        meta = dict(row.meta or {})
        meta["injected_at"] = now_iso
        meta["injected_digest_id"] = digest_id
        row.meta = meta

    await db.flush()


async def list_recent_dumps(
    db: AsyncSession,
    user_id: str,
    *,
    limit: int = 20,
) -> list[BrainDumpResult]:
    """Return recent brain dumps for a user."""
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
    return [_raw_to_result(row) for row in rows]


async def _structure_dump(raw_text: str, settings: Settings | None) -> dict:
    llm = get_llm_adapter(settings)
    try:
        resp = await llm.complete(
            [Message(role="user", content=_STRUCTURE_PROMPT.format(raw_text=raw_text))],
            system=_STRUCTURE_SYSTEM,
            temperature=0.1,
            json_mode=True,
        )
        raw = resp.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        data = json.loads(raw)
    except Exception as exc:
        log.exception("Brain dump structuring failed")
        raise RuntimeError("Failed to structure brain dump. Please try again.") from exc

    return {
        "title": str(data.get("title") or "Brain dump")[:120],
        "formatted_transcript": str(data.get("formatted_transcript") or raw_text)[:10_000],
        "clean_summary": str(data.get("clean_summary") or raw_text[:2000]),
        "intent_type": str(data.get("intent_type") or "general_context"),
        "action_items": [str(a) for a in (data.get("action_items") or []) if a][:10],
        "relevance_keywords": [str(k) for k in (data.get("relevance_keywords") or []) if k][:8],
        "should_inject_into_morning_brief": bool(data.get("should_inject_into_morning_brief")),
    }


async def _persist_dump(
    db: AsyncSession,
    user_id: str,
    *,
    raw_transcript: str,
    structured: dict,
    input_mode: str,
    settings: Settings | None = None,
    audio_meta: dict | None = None,
) -> BrainDumpResult:
    s = settings or get_settings()
    source = await _get_or_create_source(db, user_id)

    content_hash = hashlib.sha256(raw_transcript.encode("utf-8", errors="replace")).hexdigest()

    existing = await db.execute(
        select(RawContent).where(
            RawContent.source_id == source.id,
            RawContent.content_hash == content_hash,
        )
    )
    if existing.scalar_one_or_none():
        raise ValueError("This exact brain dump was already saved.")

    display_transcript = structured.get("formatted_transcript") or raw_transcript

    meta = {
        "brain_dump": True,
        "input_mode": input_mode,
        "intent_type": structured["intent_type"],
        "action_items": structured["action_items"],
        "relevance_keywords": structured["relevance_keywords"],
        "should_inject_into_morning_brief": structured["should_inject_into_morning_brief"],
        "raw_transcript": display_transcript[:10_000],
    }
    if audio_meta:
        meta["audio"] = audio_meta
        meta["stt_transcript"] = raw_transcript[:10_000]

    row = RawContent(
        source_id=source.id,
        user_id=user_id,
        status=ContentStatus.processed,
        title=structured["title"],
        author="You",
        raw_text=display_transcript[:50_000],
        clean_text=structured["clean_summary"],
        summary=structured["clean_summary"],
        content_hash=content_hash,
        relevance_score=1.0,
        meta=meta,
    )
    db.add(row)
    await db.flush()

    embedder = get_embedding_adapter(s)
    embed_text = embedder.embed_text_for_content(
        structured["title"],
        structured["clean_summary"],
        "Brain Dump",
    )
    embedding = await embedder.embed(embed_text)
    db.add(ContentEmbedding(
        content_id=row.id,
        embedding=embedding,
        model=s.embedding_model if s.embedding_provider == "voyage" else "text-embedding-3-small",
    ))

    await _update_profile_from_dump(db, user_id, structured, embedder, s)
    await db.commit()
    await db.refresh(row)

    log.info("Brain dump saved for user %s (mode=%s, id=%s)", user_id, input_mode, row.id)
    return _raw_to_result(row)


async def _get_or_create_source(db: AsyncSession, user_id: str) -> Source:
    result = await db.execute(
        select(Source).where(
            Source.user_id == user_id,
            Source.source_type == BRAIN_DUMP_SOURCE_TYPE,
            Source.identifier == BRAIN_DUMP_IDENTIFIER,
        )
    )
    source = result.scalar_one_or_none()
    if source:
        return source

    source = Source(
        user_id=user_id,
        source_type=BRAIN_DUMP_SOURCE_TYPE,
        identifier=BRAIN_DUMP_IDENTIFIER,
        name="Brain Dump",
        status=SourceStatus.active,
        meta={"description": "Personal thoughts and voice notes"},
    )
    db.add(source)
    await db.flush()
    return source


async def _update_profile_from_dump(
    db: AsyncSession,
    user_id: str,
    structured: dict,
    embedder,
    settings: Settings,
) -> None:
    """Merge keywords into interests and blend profile embedding."""
    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return

    keywords = structured.get("relevance_keywords") or []
    if keywords:
        interests = list(profile.interests or [])
        existing_topics = {i.get("topic", "").lower() for i in interests}
        for kw in keywords:
            if kw.lower() not in existing_topics:
                interests.append({"topic": kw, "weight": 0.7, "source": "brain_dump"})
                existing_topics.add(kw.lower())
        profile.interests = interests

    signal_text = " | ".join([
        structured.get("clean_summary", ""),
        " ".join(keywords),
        " ".join(structured.get("action_items") or []),
    ]).strip()
    if not signal_text:
        return

    try:
        new_vec = await embedder.embed(signal_text)
        old_vec = profile.profile_embedding

        if old_vec and len(old_vec) == len(new_vec):
            alpha = _PROFILE_BLEND_ALPHA
            blended = [
                (1 - alpha) * o + alpha * n
                for o, n in zip(old_vec, new_vec)
            ]
            await db.execute(
                update(UserProfile)
                .where(UserProfile.user_id == user_id)
                .values(profile_embedding=blended, interests=profile.interests)
            )
        elif old_vec and len(old_vec) != len(new_vec):
            log.warning(
                "Profile embedding dim mismatch for user %s (%d vs %d) — replacing with new vector",
                user_id, len(old_vec), len(new_vec),
            )
            await db.execute(
                update(UserProfile)
                .where(UserProfile.user_id == user_id)
                .values(profile_embedding=new_vec, interests=profile.interests)
            )
        else:
            await db.execute(
                update(UserProfile)
                .where(UserProfile.user_id == user_id)
                .values(profile_embedding=new_vec, interests=profile.interests)
            )
    except Exception:
        log.exception("Failed to update profile embedding from brain dump for user %s", user_id)


def why_it_matters_for_dump(dump: BrainDumpResult) -> str:
    parts: list[str] = []
    if dump.action_items:
        joined = "; ".join(dump.action_items[:5])
        parts.append(f"Action items you noted: {joined}.")
    intent_copy = {
        "project_idea": "You saved this as a project idea to revisit in your morning brief.",
        "action_item": "You flagged this as something to act on — surfacing it at the top of today.",
        "general_context": "You asked Briefly to include this thought in today's briefing.",
    }
    parts.append(intent_copy.get(dump.intent_type, intent_copy["general_context"]))
    return " ".join(parts)


def _raw_to_result(row: RawContent) -> BrainDumpResult:
    meta = row.meta or {}
    injected_at = None
    if meta.get("injected_at"):
        try:
            injected_at = datetime.fromisoformat(str(meta["injected_at"]).replace("Z", "+00:00"))
        except ValueError:
            injected_at = None
    return BrainDumpResult(
        id=row.id,
        title=row.title or "Brain dump",
        clean_summary=row.clean_text or row.summary or "",
        intent_type=meta.get("intent_type", "general_context"),
        action_items=meta.get("action_items") or [],
        relevance_keywords=meta.get("relevance_keywords") or [],
        should_inject_into_morning_brief=bool(meta.get("should_inject_into_morning_brief")),
        raw_transcript=meta.get("raw_transcript") or row.raw_text or "",
        input_mode=meta.get("input_mode", "text"),
        created_at=row.ingested_at or datetime.now(timezone.utc),
        injected_at=injected_at,
        injected_digest_id=meta.get("injected_digest_id"),
    )
