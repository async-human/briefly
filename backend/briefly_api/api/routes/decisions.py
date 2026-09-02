"""Decision Threads — persistent strategic questions and beliefs.

GET    /decision-threads
POST   /decision-threads
PATCH  /decision-threads/{id}
GET    /decision-threads/{id}/timeline

No new frontend page. Settings and the dashboard glance consume this.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.db.engine import get_db
from briefly_api.db.models import DecisionThread, User
from briefly_api.services.decisions.outcomes import outcome_dict, record_decision_outcome
from briefly_api.services.decisions.timeline import get_thread_timeline
from briefly_api.services.decisions.threads import (
    create_thread,
    get_thread,
    list_threads,
    snapshot_dict,
    update_thread,
)

router = APIRouter(tags=["decision-threads"])


class DecisionThreadOut(BaseModel):
    id: str
    title: str
    question: str
    belief: str | None = None
    confidence: float | None = None
    previous_confidence: float | None = None
    status: str
    source: str = "user"
    stance: str | None = None
    updated_at: datetime | None = None


class DecisionThreadIn(BaseModel):
    question: str = Field(..., min_length=8, max_length=500)
    belief: str | None = Field(default=None, max_length=800)


class DecisionThreadPatch(BaseModel):
    belief: str | None = Field(default=None, max_length=800)
    status: str | None = Field(default=None, max_length=20)


class TimelineEvidenceOut(BaseModel):
    url: str
    passage: str = ""
    source_name: str = ""


class TimelineEventOut(BaseModel):
    at: datetime
    type: Literal["belief_edit", "confidence_change", "signal", "outcome"]
    headline: str | None = None
    belief: str | None = None
    confidence: float | None = None
    previous_confidence: float | None = None
    stance: str | None = None
    rationale: str | None = None
    note: str | None = None
    signal_id: str | None = None
    evidence: list[TimelineEvidenceOut] = Field(default_factory=list)
    outcome: str | None = None
    action: str | None = None


class DecisionOutcomeIn(BaseModel):
    outcome: Literal["changed", "confirmed", "action_planned", "acted", "no_change"]
    thread_id: str | None = None
    signal_id: str | None = None
    digest_item_id: str | None = None
    source: Literal["glance", "read", "ask", "timeline"] = "read"
    note: str | None = Field(default=None, max_length=800)
    action: str | None = Field(default=None, max_length=800)


class DecisionOutcomeOut(BaseModel):
    id: str
    thread_id: str | None = None
    signal_id: str | None = None
    digest_item_id: str | None = None
    outcome: str
    source: str
    note: str | None = None
    action: str | None = None
    created_at: datetime | None = None


def _serialize(thread: DecisionThread) -> DecisionThreadOut:
    snap = snapshot_dict(thread)
    return DecisionThreadOut(
        id=thread.id,
        title=snap["title"],
        question=snap["question"],
        belief=snap["belief"],
        confidence=snap["confidence"],
        previous_confidence=snap["previous_confidence"],
        status=snap["status"],
        source=thread.source or "user",
        stance=snap.get("stance"),
        updated_at=thread.updated_at,
    )


@router.get("/decision-threads", response_model=list[DecisionThreadOut])
async def get_decision_threads(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DecisionThreadOut]:
    threads = await list_threads(db, user.id)
    return [_serialize(t) for t in threads]


@router.post("/decision-threads", response_model=DecisionThreadOut, status_code=status.HTTP_201_CREATED)
async def post_decision_thread(
    body: DecisionThreadIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DecisionThreadOut:
    try:
        thread = await create_thread(
            db,
            user.id,
            body.question,
            belief=body.belief or "",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    await db.refresh(thread)
    return _serialize(thread)


@router.patch("/decision-threads/{thread_id}", response_model=DecisionThreadOut)
async def patch_decision_thread(
    thread_id: str,
    body: DecisionThreadPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DecisionThreadOut:
    try:
        thread = await update_thread(
            db,
            user.id,
            thread_id,
            belief=body.belief,
            status=body.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Decision thread not found.")
    await db.commit()
    await db.refresh(thread)
    return _serialize(thread)


@router.get("/decision-threads/{thread_id}/timeline", response_model=list[TimelineEventOut])
async def get_decision_thread_timeline(
    thread_id: str,
    days: int = Query(default=90, ge=1, le=365),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[TimelineEventOut]:
    thread = await get_thread(db, user.id, thread_id)
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Decision thread not found.")
    rows = await get_thread_timeline(db, user.id, thread_id, days=days)
    return [
        TimelineEventOut(
            at=row["at"],
            type=row["type"],
            headline=row.get("headline"),
            belief=row.get("belief"),
            confidence=row.get("confidence"),
            previous_confidence=row.get("previous_confidence"),
            stance=row.get("stance"),
            rationale=row.get("rationale"),
            note=row.get("note"),
            signal_id=row.get("signal_id"),
            evidence=[
                TimelineEvidenceOut(
                    url=e.get("url") or "",
                    passage=e.get("passage") or "",
                    source_name=e.get("source_name") or "",
                )
                for e in (row.get("evidence") or [])
            ],
            outcome=row.get("outcome"),
            action=row.get("action"),
        )
        for row in rows
    ]


@router.post("/decision-outcomes", response_model=DecisionOutcomeOut, status_code=status.HTTP_201_CREATED)
async def post_decision_outcome(
    body: DecisionOutcomeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DecisionOutcomeOut:
    try:
        row = await record_decision_outcome(
            db,
            user_id=user.id,
            outcome=body.outcome,
            thread_id=body.thread_id,
            signal_id=body.signal_id,
            digest_item_id=body.digest_item_id,
            source=body.source,
            note=body.note,
            action=body.action,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    await db.refresh(row)
    return DecisionOutcomeOut(**outcome_dict(row))
