"""
briefly_api/api/routes/email_drafts.py

Grounded email — Phase 1 of the act layer. Draft → human review → dispatch.
Nothing is sent automatically; the user reviews/edits and dispatches. Every row
is the audit record for the action.

  POST   /email-drafts/compose     draft a grounded email (status=draft)
  GET    /email-drafts             recent drafts
  GET    /email-drafts/{id}        one draft
  PATCH  /email-drafts/{id}        edit recipient / subject / body
  POST   /email-drafts/{id}/sent   mark dispatched (audit) — set status=sent
  DELETE /email-drafts/{id}        discard
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.auth.gmail import (
    GmailAccessError,
    create_gmail_draft,
    gmail_connection_can_create_draft,
    gmail_connection_can_send,
    get_gmail_connection,
    send_gmail_message,
)
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import EmailDraft, RawContent, User
from briefly_api.services.email_drafts import compose_email_draft

router = APIRouter(prefix="/email-drafts", tags=["email-drafts"])


class ComposeIn(BaseModel):
    instruction: str
    content_id: str | None = None


class EditIn(BaseModel):
    to_email: str | None = None
    to_name: str | None = None
    subject: str | None = None
    body: str | None = None


class EmailDraftOut(BaseModel):
    id: str
    to_email: str | None
    to_name: str | None
    subject: str
    body: str
    rationale: str | None
    status: str
    source_content_ids: list[str]
    source_headlines: list[str] = []  # citations: what this draft was grounded in
    created_at: str | None


def _serialize(d: EmailDraft, source_headlines: list[str] | None = None) -> EmailDraftOut:
    return EmailDraftOut(
        id=d.id,
        to_email=d.to_email,
        to_name=d.to_name,
        subject=d.subject,
        body=d.body,
        rationale=d.rationale,
        status=d.status,
        source_content_ids=list(d.source_content_ids or []),
        source_headlines=source_headlines or [],
        created_at=d.created_at.isoformat() if d.created_at else None,
    )


async def _resolve_headlines(db: AsyncSession, content_ids: list[str]) -> list[str]:
    """Best-effort: map a draft's grounding content_ids back to titles so the review
    card can show 'grounded in …' citations — the trust proof. Resolves from
    RawContent so it covers both today's-brief and whole-corpus (Stage 2) items."""
    if not content_ids:
        return []
    rows = (
        await db.execute(
            select(RawContent.title)
            .where(RawContent.id.in_(content_ids))
            .limit(8)
        )
    ).all()
    seen: list[str] = []
    for (title,) in rows:
        t = (title or "").strip()
        if t and t not in seen:
            seen.append(t)
    return seen


async def _get_owned(db: AsyncSession, user_id: str, draft_id: str) -> EmailDraft:
    draft = (
        await db.execute(
            select(EmailDraft).where(EmailDraft.id == draft_id, EmailDraft.user_id == user_id)
        )
    ).scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    return draft


@router.post("/compose", response_model=EmailDraftOut, status_code=status.HTTP_201_CREATED)
async def compose(
    body: ComposeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailDraftOut:
    if not body.instruction.strip():
        raise HTTPException(status_code=400, detail="Instruction is required.")
    draft = await compose_email_draft(db, user, body.instruction, content_id=body.content_id)
    headlines = await _resolve_headlines(db, list(draft.source_content_ids or []))
    return _serialize(draft, headlines)


@router.get("", response_model=list[EmailDraftOut])
async def list_drafts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[EmailDraftOut]:
    rows = (
        await db.execute(
            select(EmailDraft)
            .where(EmailDraft.user_id == user.id, EmailDraft.status != "discarded")
            .order_by(EmailDraft.created_at.desc())
            .limit(20)
        )
    ).scalars().all()
    return [_serialize(d) for d in rows]


@router.get("/capabilities")
async def capabilities(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """What Briefly can do with the user's Gmail: create a draft (gmail.compose,
    the safe default) and/or send directly (gmail.send)."""
    conn = await get_gmail_connection(db, user.id)
    return {
        "can_create_draft": gmail_connection_can_create_draft(conn),
        "can_send": gmail_connection_can_send(conn),
        "gmail_email": conn.account_email if conn else None,
    }


@router.get("/{draft_id}", response_model=EmailDraftOut)
async def get_draft(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailDraftOut:
    draft = await _get_owned(db, user.id, draft_id)
    headlines = await _resolve_headlines(db, list(draft.source_content_ids or []))
    return _serialize(draft, headlines)


@router.patch("/{draft_id}", response_model=EmailDraftOut)
async def edit_draft(
    draft_id: str,
    body: EditIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailDraftOut:
    draft = await _get_owned(db, user.id, draft_id)
    if body.to_email is not None:
        draft.to_email = body.to_email.strip() or None
    if body.to_name is not None:
        draft.to_name = body.to_name.strip() or None
    if body.subject is not None:
        draft.subject = body.subject
    if body.body is not None:
        draft.body = body.body
    await db.commit()
    await db.refresh(draft)
    return _serialize(draft)


async def _enforce_daily_cap(db: AsyncSession, user_id: str, settings: Settings) -> None:
    """Per-day budget on Gmail actions (send + draft-create) — the act-layer
    budget non-negotiable; cheap insurance against a runaway loop or abuse."""
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    count = (
        await db.execute(
            select(func.count())
            .select_from(EmailDraft)
            .where(
                EmailDraft.user_id == user_id,
                EmailDraft.status.in_(("sent", "drafted_to_gmail")),
                EmailDraft.sent_at >= today_start,
            )
        )
    ).scalar() or 0
    if count >= settings.act_email_daily_cap:
        raise HTTPException(
            status_code=429,
            detail=f"Daily limit reached ({settings.act_email_daily_cap} emails). Try again tomorrow.",
        )


@router.post("/{draft_id}/to-gmail", response_model=EmailDraftOut)
async def draft_to_gmail(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> EmailDraftOut:
    """Create the draft in the user's Gmail (gmail.compose) — the safe default.
    Briefly never sends; the user opens Gmail and hits Send themselves."""
    draft = await _get_owned(db, user.id, draft_id)

    conn = await get_gmail_connection(db, user.id)
    if not gmail_connection_can_create_draft(conn):
        raise HTTPException(
            status_code=409,
            detail="Reconnect Gmail to let Briefly create drafts for you.",
        )

    await _enforce_daily_cap(db, user.id, settings)

    try:
        await create_gmail_draft(
            conn,
            settings,
            to=draft.to_email,
            subject=draft.subject,
            body=draft.body,
            from_email=conn.account_email,
        )
    except GmailAccessError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    draft.status = "drafted_to_gmail"
    draft.sent_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(draft)
    headlines = await _resolve_headlines(db, list(draft.source_content_ids or []))
    return _serialize(draft, headlines)


@router.post("/{draft_id}/send", response_model=EmailDraftOut)
async def send_draft(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> EmailDraftOut:
    """Send the draft via the user's Gmail (explicit, user-triggered — the HITL
    confirm). Requires the gmail.send scope; otherwise tells the client to
    reconnect Gmail."""
    draft = await _get_owned(db, user.id, draft_id)
    if not (draft.to_email or "").strip():
        raise HTTPException(status_code=400, detail="Add a recipient before sending.")

    conn = await get_gmail_connection(db, user.id)
    if not gmail_connection_can_send(conn):
        raise HTTPException(
            status_code=409,
            detail="Reconnect Gmail to let Briefly send on your behalf.",
        )

    await _enforce_daily_cap(db, user.id, settings)

    try:
        await send_gmail_message(
            conn,
            settings,
            to=draft.to_email,
            subject=draft.subject,
            body=draft.body,
            from_email=conn.account_email,
        )
    except GmailAccessError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    draft.status = "sent"
    draft.sent_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(draft)
    return _serialize(draft)


@router.post("/{draft_id}/sent", response_model=EmailDraftOut)
async def mark_sent(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailDraftOut:
    draft = await _get_owned(db, user.id, draft_id)
    draft.status = "sent"
    draft.sent_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(draft)
    return _serialize(draft)


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def discard_draft(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await db.execute(
        delete(EmailDraft).where(EmailDraft.id == draft_id, EmailDraft.user_id == user.id)
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
