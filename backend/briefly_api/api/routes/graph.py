from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.db.engine import get_db
from briefly_api.db.models import User
from briefly_api.services.entity_hub import build_entity_hub
from briefly_api.services.graph_actions import boost_topic, mute_topic, set_source_graph_priority
from briefly_api.services.knowledge_graph import build_knowledge_graph, graph_to_dict

router = APIRouter(tags=["graph"])


class GraphTopicActionIn(BaseModel):
    topic: str = Field(..., min_length=1, max_length=255)
    action: Literal["boost", "mute"]


class GraphSourceActionIn(BaseModel):
    source_id: str = Field(..., min_length=1, max_length=36)
    action: Literal["prioritize", "deprioritize"]


@router.get("/graph")
async def get_knowledge_graph(
    days: int | None = Query(default=None, ge=1, le=365, description="Limit graph to recent N days"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    profile = user.profile
    graph = await build_knowledge_graph(db, user.id, profile, days=days)
    return graph_to_dict(graph)


@router.get("/graph/hub")
async def get_entity_hub(
    node_id: str | None = Query(default=None, max_length=200),
    q: str | None = Query(default=None, max_length=200),
    days: int | None = Query(default=None, ge=1, le=365),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not (node_id or (q and q.strip())):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide node_id or q.",
        )
    hub = await build_entity_hub(
        db, user.id, user.profile, node_id=node_id, q=q, days=days
    )
    if hub is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    return hub


@router.post("/graph/actions/topic")
async def graph_topic_action(
    body: GraphTopicActionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not user.profile:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Profile not found.")
    try:
        if body.action == "boost":
            result = await boost_topic(user.profile, body.topic)
        else:
            result = await mute_topic(user.profile, body.topic)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    return result


@router.post("/graph/actions/source")
async def graph_source_action(
    body: GraphSourceActionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        result = await set_source_graph_priority(
            db, user.profile, user.id, body.source_id, body.action
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    return result
