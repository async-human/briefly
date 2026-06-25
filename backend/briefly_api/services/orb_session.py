"""
briefly_api/services/orb_session.py

Lightweight voice session state — ties thread_id, tool state, and client surface
together across orb turns. Stored in Redis with in-memory fallback for dev/tests.
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from briefly_api.config import get_settings

log = logging.getLogger(__name__)

_MEMORY: dict[str, str] = {}


@dataclass
class OrbSessionState:
    session_id: str
    user_id: str
    thread_id: str | None = None
    surface: str = "desktop"
    active_email_draft_id: str | None = None
    last_transcript: str | None = None
    last_tool: str | None = None
    route_kind: str | None = None
    tool_slots: dict[str, Any] = field(default_factory=dict)
    last_answer: str | None = None
    active_goal: dict[str, Any] | None = None
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> OrbSessionState:
        return cls(
            session_id=str(data.get("session_id") or ""),
            user_id=str(data.get("user_id") or ""),
            thread_id=data.get("thread_id"),
            surface=str(data.get("surface") or "desktop"),
            active_email_draft_id=data.get("active_email_draft_id"),
            last_transcript=data.get("last_transcript"),
            last_tool=data.get("last_tool"),
            route_kind=data.get("route_kind"),
            tool_slots=dict(data.get("tool_slots") or {}),
            last_answer=data.get("last_answer"),
            active_goal=data.get("active_goal") if isinstance(data.get("active_goal"), dict) else None,
            updated_at=str(data.get("updated_at") or datetime.now(timezone.utc).isoformat()),
        )


def _redis_key(user_id: str, session_id: str) -> str:
    return f"orb:session:{user_id}:{session_id}"


async def _redis_client():
    redis_url = (get_settings().redis_url or "").strip()
    if not redis_url:
        return None
    try:
        from redis.asyncio import Redis

        return Redis.from_url(redis_url, decode_responses=True)
    except Exception:
        log.debug("orb session redis unavailable", exc_info=True)
        return None


async def create_session(
    user_id: str,
    *,
    thread_id: str | None = None,
    surface: str = "desktop",
) -> OrbSessionState:
    state = OrbSessionState(
        session_id=str(uuid.uuid4()),
        user_id=user_id,
        thread_id=thread_id,
        surface=surface,
    )
    await save_session(state)
    return state


async def get_session(user_id: str, session_id: str) -> OrbSessionState | None:
    if not session_id:
        return None
    key = _redis_key(user_id, session_id)
    client = await _redis_client()
    raw: str | None = None
    if client is not None:
        try:
            raw = await client.get(key)
        finally:
            await client.aclose()
    else:
        raw = _MEMORY.get(key)
    if not raw:
        return None
    try:
        return OrbSessionState.from_dict(json.loads(raw))
    except Exception:
        return None


async def save_session(state: OrbSessionState) -> None:
    state.updated_at = datetime.now(timezone.utc).isoformat()
    key = _redis_key(state.user_id, state.session_id)
    payload = json.dumps(state.to_dict())
    ttl = get_settings().orb_session_ttl_seconds
    client = await _redis_client()
    if client is not None:
        try:
            await client.setex(key, ttl, payload)
        finally:
            await client.aclose()
    else:
        _MEMORY[key] = payload


async def resolve_session(
    user_id: str,
    *,
    session_id: str | None = None,
    thread_id: str | None = None,
    surface: str = "desktop",
) -> OrbSessionState:
    """Load an existing session or create one."""
    if session_id:
        existing = await get_session(user_id, session_id)
        if existing is not None:
            if thread_id:
                existing.thread_id = thread_id
            return existing
    return await create_session(user_id, thread_id=thread_id, surface=surface)


async def update_session_after_turn(
    state: OrbSessionState,
    *,
    thread_id: str | None = None,
    transcript: str | None = None,
    draft_id: str | None = None,
    last_tool: str | None = None,
    route_kind: str | None = None,
    last_answer: str | None = None,
    tool_slots: dict[str, Any] | None = None,
    active_goal: dict[str, Any] | None = None,
) -> OrbSessionState:
    if thread_id:
        state.thread_id = thread_id
    if transcript:
        state.last_transcript = transcript[:2000]
    if last_answer is not None:
        state.last_answer = last_answer[:4000]
    if draft_id:
        state.active_email_draft_id = draft_id
    if last_tool:
        state.last_tool = last_tool
    if route_kind:
        state.route_kind = route_kind
    if tool_slots is not None:
        state.tool_slots = tool_slots
    if active_goal is not None:
        state.active_goal = active_goal
    await save_session(state)
    return state
