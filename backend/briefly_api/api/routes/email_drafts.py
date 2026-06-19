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
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.auth.gmail import (
    GmailAccessError,
    gmail_connection_can_send,
    get_gmail_connection,
    send_gmail_message,
)
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import EmailDraft, User
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
    created_at: str | None


def _serialize(d: EmailDraft) -> EmailDraftOut:
    return EmailDraftOut(
        id=d.id,
        to_email=d.to_email,
        to_name=d.to_name,
        subject=d.subject,
        body=d.body,
        rationale=d.rationale,
        status=d.status,
        source_content_ids=list(d.source_content_ids or []),
        created_at=d.created_at.isoformat() if d.created_at else None,
    )


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
    return _serialize(draft)


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
    """Whether Briefly can send email directly (gmail.send granted) + the address."""
    conn = await get_gmail_connection(db, user.id)
    return {
        "can_send": gmail_connection_can_send(conn),
        "gmail_email": conn.account_email if conn else None,
    }


@router.get("/{draft_id}", response_model=EmailDraftOut)
async def get_draft(
    draft_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EmailDraftOut:
    return _serialize(await _get_owned(db, user.id, draft_id))


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
