"""
briefly_api/services/email_drafts.py

Phase 1 of the "act" layer: draft an email grounded in what the user has read.
The agent only ever produces a *draft* — sending is a separate, explicit,
human-in-the-loop step. This service does the grounded composition.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import Digest, DigestItem, EmailDraft, User
from briefly_api.llm.adapter import Message, get_llm_adapter

log = logging.getLogger(__name__)

_SYSTEM = (
    "You draft concise, professional emails on behalf of the user, grounded ONLY "
    "in the context provided (things the user has actually read). Never invent "
    "facts, numbers, quotes, or links beyond that context. Write in the user's "
    "voice, first person, 80–160 words, plain text (no markdown). If the "
    "instruction implies a recipient, infer a short to_hint (e.g. 'your team', "
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


async def compose_from_context(
    instruction: str,
    context: str,
    name: str,
    *,
    user_id: str | None = None,
) -> dict:
    """Pure grounded composition: (instruction, context, name) → parsed draft fields.

    Shared by the live draft path AND the eval harness so we measure exactly what
    ships. Returns {subject, body, rationale, to_hint}. Raises on LLM failure.
    """
    user_prompt = (
        f"User's name: {name or 'the user'}\n"
        f"Instruction: {instruction.strip()}\n\n"
        f"Context — things the user has read:\n{context or '(no recent brief found)'}\n\n"
        "Draft the email now as strict JSON."
    )
    llm = get_llm_adapter()
    response = await llm.complete(
        [Message(role="user", content=user_prompt)],
        system=_SYSTEM,
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
    """Compose a grounded email draft. Persists it as status='draft' (not sent)."""
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
