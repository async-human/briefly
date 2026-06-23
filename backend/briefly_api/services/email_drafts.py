"""
briefly_api/services/email_drafts.py

Phase 1 of the "act" layer: draft an email grounded in what the user has read.
The agent only ever produces a *draft* — sending is a separate, explicit,
human-in-the-loop step. This service does the grounded composition.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import get_settings
from briefly_api.db.models import (
    ContentEmbedding,
    Digest,
    DigestItem,
    EmailDraft,
    RawContent,
    User,
)
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.llm.adapter import Message, get_llm_adapter

log = logging.getLogger(__name__)

# Stage 2 corpus grounding: how relevant a past item must be to ground a draft.
_CORPUS_MIN_SIMILARITY = 0.25
_CORPUS_MAX_DISTANCE = 1.0 - _CORPUS_MIN_SIMILARITY

_SYSTEM = (
    "You draft concise, professional emails on behalf of the user, grounded ONLY in "
    "the CONTEXT provided (things the user has actually read). The context is your "
    "ONLY source of truth — you have NO outside knowledge to draw on.\n"
    "Hard rules:\n"
    "1. Never invent facts, figures, names, dates, quotes, or links. Reproduce any "
    "numbers, names, and quotations EXACTLY as they appear in the context, and keep "
    "quotes attributed to the correct source.\n"
    "2. If the context does not contain something the instruction asks for, do NOT "
    "supply it from general knowledge. Write the email without it and briefly note that "
    "detail isn't in their sources (or ask the user for it).\n"
    "3. If sources conflict, surface the discrepancy — never silently pick one as fact.\n"
    "4. If the context is empty or irrelevant, do not fabricate: write a short scaffold "
    "or ask for the key facts instead.\n"
    "5. Obey the instruction's focus and any exclusions exactly.\n"
    "Write in the user's voice, first person, 80–160 words, plain text (no markdown). If "
    "the instruction implies a recipient, infer a short to_hint (e.g. 'your team', "
    "'the author'); otherwise leave it empty. "
    'Return STRICT JSON only: {"to_hint": string, "subject": string, '
    '"body": string, "rationale": string}. "rationale" is one sentence on why '
    "this draft fits the instruction and context."
)


async def _grounding_context(
    db: AsyncSession, user_id: str, content_id: str | None
) -> tuple[str, list[str]]:
    """Return (context_text, source_content_ids) from the user's recent reading."""
    digest = (
        await db.execute(
            select(Digest)
            .where(Digest.user_id == user_id)
            .order_by(Digest.digest_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not digest:
        return ("", [])

    items = (
        await db.execute(
            select(DigestItem)
            .where(DigestItem.digest_id == digest.id)
            .order_by(DigestItem.position.asc())
            .limit(8)
        )
    ).scalars().all()

    # If a specific item is referenced, lead with it.
    if content_id:
        items.sort(key=lambda it: 0 if it.content_id == content_id else 1)

    lines: list[str] = []
    source_ids: list[str] = []
    for it in items:
        lines.append(f"- {it.headline}. {(it.summary or it.why_it_matters or '').strip()}")
        if it.content_id:
            source_ids.append(it.content_id)
    return ("\n".join(lines), source_ids[:8])


async def _corpus_grounding_context(
    db: AsyncSession,
    user_id: str,
    instruction: str,
    content_id: str | None = None,
    *,
    limit: int = 6,
) -> tuple[str, list[str]] | None:
    """Stage 2: ground the draft in the user's ENTIRE reading history, not just
    today's brief. Embed the instruction and semantic-search the corpus for the
    most relevant items. Returns (context_text, source_ids), or None to signal the
    caller to fall back to the brief (so this is never worse than Stage 1).
    """
    instruction = (instruction or "").strip()
    if not instruction:
        return None
    try:
        query_emb = await get_embedding_adapter().embed(instruction)
    except Exception:
        log.debug("corpus grounding: embed failed — falling back", exc_info=True)
        return None
    if not query_emb:
        return None

    distance = ContentEmbedding.embedding.cosine_distance(query_emb)
    stmt = (
        select(RawContent.id, RawContent.title, RawContent.summary, RawContent.clean_text)
        .join(ContentEmbedding, ContentEmbedding.content_id == RawContent.id)
        .where(RawContent.user_id == user_id)
        .where(distance <= _CORPUS_MAX_DISTANCE)
        .order_by(distance)
        .limit(limit)
    )
    try:
        rows = (await db.execute(stmt)).all()
    except Exception:
        log.debug("corpus grounding: retrieval query failed — falling back", exc_info=True)
        return None

    lines: list[str] = []
    ids: list[str] = []

    # Anchor: if the user is drafting "about this item", make sure it's included.
    if content_id:
        anchor = await db.get(RawContent, content_id)
        if anchor is not None:
            snippet = (anchor.summary or anchor.clean_text or "").strip()[:300]
            lines.append(f"- {(anchor.title or 'Untitled').strip()}. {snippet}".strip())
            ids.append(anchor.id)

    for cid, title, summary, clean_text in rows:
        if cid in ids:
            continue
        snippet = (summary or clean_text or "").strip()[:300]
        lines.append(f"- {(title or 'Untitled').strip()}. {snippet}".strip())
        ids.append(cid)

    if not lines:
        return None
    return "\n".join(lines), ids[:8]


def _parse_json(text: str) -> dict:
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t.lower().startswith("json"):
            t = t[4:]
    start, end = t.find("{"), t.rfind("}")
    if start >= 0 and end > start:
        t = t[start : end + 1]
    try:
        return json.loads(t)
    except (json.JSONDecodeError, ValueError):
        return {}


_ANSWERABILITY_SYSTEM = (
    "You decide whether the CONTEXT has enough substance to write a USEFUL, honest email "
    "for the INSTRUCTION WITHOUT inventing facts. Lean toward CAN answer. "
    "Answer CANNOT only when writing the email would force inventing specific facts that "
    "are simply absent — e.g. a figure/metric the context never states, or a topic the "
    "context never covers at all, or empty context. "
    "If the context has relevant material and a useful draft can be written from it — even "
    "when the user's wording is loose (a quote 'about moats' that is actually about "
    "distribution still counts), or the task is to summarize, select, or EXCLUDE something "
    "— then it CAN answer. Only refuse when answering would require invention. "
    "Respond in STRICT JSON only."
)

_GAP_SYSTEM = (
    "The user's CONTEXT does NOT contain the information their instruction needs. Write a "
    "short, honest email IN THE USER'S VOICE that says what you can from the context and "
    "CLEARLY notes the missing piece isn't in their sources yet / asks them to provide it. "
    "Do NOT invent any facts, figures, names, quotes, links, or analysis — not even "
    "plausible ones. First person, plain text, under 120 words. "
    'Return STRICT JSON only: {"to_hint": string, "subject": string, "body": string, '
    '"rationale": string}.'
)

_EMPTY_MARKERS = ("", "(no recent brief found)", "(none)")


async def _assess_answerability(instruction: str, context: str, *, user_id: str | None = None) -> dict:
    """Pre-flight gate: can the context support this instruction without invention?
    Returns {"can_answer": bool, "missing": str}. Fails OPEN (assume answerable) on
    error so it never blocks a normal draft."""
    ctx = (context or "").strip()
    if ctx in _EMPTY_MARKERS:
        return {"can_answer": False, "missing": "there's no brief content to draw on"}

    s = get_settings()
    llm = get_llm_adapter()
    prompt = (
        f"INSTRUCTION:\n{instruction.strip()}\n\nCONTEXT:\n{ctx}\n\n"
        'Return JSON: {"can_answer": <true|false>, "missing": "<if false, what specific '
        'fact/topic the context lacks>"}.'
    )
    try:
        data = await llm.complete_json(
            [Message(role="user", content=prompt)],
            system=_ANSWERABILITY_SYSTEM,
            model=(getattr(s, "eval_judge_model", "") or None),  # prefer a cheap model
            user_id=user_id,
            agent="email_answerability",
        )
        if isinstance(data, dict) and "can_answer" in data:
            return {"can_answer": bool(data.get("can_answer")), "missing": str(data.get("missing") or "")}
    except Exception:
        log.debug("answerability check failed — failing open", exc_info=True)
    return {"can_answer": True, "missing": ""}


async def compose_from_context(
    instruction: str,
    context: str,
    name: str,
    *,
    user_id: str | None = None,
) -> dict:
    """Pure grounded composition: (instruction, context, name) → parsed draft fields.

    Structural grounding gate: a pre-flight answerability check decides whether the
    context can support the ask. If not, we compose in a constrained "gap mode" that
    acknowledges what's missing instead of fabricating — enforcement, not a polite
    request. Shared by the live draft path AND the eval harness so we measure exactly
    what ships. Returns {subject, body, rationale, to_hint}. Raises on LLM failure.
    """
    gap = await _assess_answerability(instruction, context, user_id=user_id)

    if not gap["can_answer"]:
        system = _GAP_SYSTEM
        user_prompt = (
            f"User's name: {name or 'the user'}\n"
            f"Instruction: {instruction.strip()}\n\n"
            f"Context — things the user has read:\n{context or '(no recent brief found)'}\n\n"
            f"What's missing: {gap['missing']}\n\n"
            "Write the honest gap email now as strict JSON."
        )
    else:
        system = _SYSTEM
        user_prompt = (
            f"User's name: {name or 'the user'}\n"
            f"Instruction: {instruction.strip()}\n\n"
            f"Context — things the user has read:\n{context or '(no recent brief found)'}\n\n"
            "Draft the email now as strict JSON."
        )

    llm = get_llm_adapter()
    response = await llm.complete(
        [Message(role="user", content=user_prompt)],
        system=system,
        temperature=0.4,
        max_tokens=700,
        user_id=user_id,
        agent="email_draft",
    )
    parsed = _parse_json(response.content)
    body = (parsed.get("body") or "").strip() or response.content.strip()
    return {
        "subject": (parsed.get("subject") or "").strip(),
        "body": body,
        "rationale": (parsed.get("rationale") or "").strip() or None,
        "to_hint": (parsed.get("to_hint") or "").strip() or None,
    }


async def compose_email_draft(
    db: AsyncSession,
    user: User,
    instruction: str,
    *,
    content_id: str | None = None,
) -> EmailDraft:
    """Compose a grounded email draft. Persists it as status='draft' (not sent).

    Stage 2: grounds in the user's whole corpus via retrieval, falling back to
    today's brief if retrieval is unavailable or finds nothing relevant."""
    grounding = await _corpus_grounding_context(db, user.id, instruction, content_id)
    if grounding is not None:
        context, source_ids = grounding
    else:
        context, source_ids = await _grounding_context(db, user.id, content_id)

    name = (user.name or "").strip()
    try:
        fields = await compose_from_context(instruction, context, name, user_id=user.id)
    except Exception:
        log.exception("compose_email_draft: LLM failed for user %s", user.id)
        raise

    subject = fields["subject"]
    body = fields["body"]
    rationale = fields["rationale"]
    to_hint = fields["to_hint"]

    draft = EmailDraft(
        user_id=user.id,
        to_email=None,
        to_name=to_hint,
        subject=subject or "(no subject)",
        body=body,
        rationale=rationale,
        instruction=instruction.strip()[:2000],
        source_content_ids=source_ids,
        status="draft",
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return draft


# ── Conversational (voice) editing ────────────────────────────────────────────

_REVISE_SYSTEM = (
    "You revise an EXISTING email draft per the user's spoken instruction. Apply ONLY "
    "the requested change. Do NOT introduce new facts, figures, names, quotes, or links "
    "that aren't already in the draft — keep it grounded. Preserve the user's voice; "
    "plain text, no markdown. "
    'Return STRICT JSON only: {"subject": string, "body": string} — the FULL revised email.'
)


async def get_active_draft(
    db: AsyncSession, user_id: str, *, within_minutes: int = 60
) -> EmailDraft | None:
    """The draft the user is currently working on by voice — their most recent
    unsent draft, created within the window (so stale drafts aren't picked up)."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=within_minutes)
    return (
        await db.execute(
            select(EmailDraft)
            .where(
                EmailDraft.user_id == user_id,
                EmailDraft.status.in_(("draft", "pending_send")),
                EmailDraft.created_at >= cutoff,
            )
            .order_by(EmailDraft.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def get_pending_send_draft(
    db: AsyncSession, user_id: str, *, within_minutes: int = 60
) -> EmailDraft | None:
    """The draft awaiting the user's spoken send-confirmation (recipient already set)."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=within_minutes)
    return (
        await db.execute(
            select(EmailDraft)
            .where(
                EmailDraft.user_id == user_id,
                EmailDraft.status == "pending_send",
                EmailDraft.created_at >= cutoff,
            )
            .order_by(EmailDraft.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def revise_email_draft(
    db: AsyncSession, user: User, draft: EmailDraft, revision: str
) -> EmailDraft:
    """Apply a spoken revision ('make it shorter', 'add a line about pricing') to an
    existing draft, grounded in the draft's current content. Persists and returns it."""
    revision = (revision or "").strip()
    if not revision:
        return draft

    prompt = (
        f"Current subject: {draft.subject}\n"
        f"Current body:\n{draft.body}\n\n"
        f"Revision requested: {revision}\n\n"
        "Return the full revised email as strict JSON."
    )
    resp = await get_llm_adapter().complete(
        [Message(role="user", content=prompt)],
        system=_REVISE_SYSTEM,
        temperature=0.4,
        max_tokens=700,
        user_id=user.id,
        agent="email_revise",
    )
    parsed = _parse_json(resp.content)
    new_body = (parsed.get("body") or "").strip()
    new_subject = (parsed.get("subject") or "").strip()
    if new_body:
        draft.body = new_body
    if new_subject:
        draft.subject = new_subject
    await db.commit()
    await db.refresh(draft)
    return draft
