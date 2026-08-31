"""Decision Threads — persistent strategic questions and beliefs.

GET    /decision-threads
POST   /decision-threads
PATCH  /decision-threads/{id}

No new frontend page. Settings and the dashboard glance consume this.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.db.engine import get_db
from briefly_api.db.models import DecisionThread, User
from briefly_api.services.decisions.threads import (
    create_thread,
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
