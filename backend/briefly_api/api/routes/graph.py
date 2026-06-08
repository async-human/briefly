from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.db.engine import get_db
from briefly_api.db.models import User
from briefly_api.services.knowledge_graph import build_knowledge_graph, graph_to_dict

router = APIRouter(tags=["graph"])


@router.get("/graph")
async def get_knowledge_graph(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Interactive knowledge graph for the signed-in user.

    Nodes: topic clusters, sources, articles, thoughts (brain dumps), story threads.
    Edges: produces, belongs_to, updates, related_to (embedding similarity), etc.
    """
    profile = user.profile
    graph = await build_knowledge_graph(db, user.id, profile)
    return graph_to_dict(graph)
