"""
briefly_api/services/orb_tools.py

Declarative tool registry for the voice orb.

Each tool is one `OrbTool`: the planner prompt, the fast-path router, and the
executor are all generated from this list — so adding a capability means
appending one entry here instead of editing four separate call sites.

Conventions:
  - `fast_patterns`  → regexes that confidently route to this tool WITHOUT an
                       LLM planner round-trip (the latency win).
  - `side_effect`    → "read" (safe) or "write". WRITE tools must be gated
                       behind explicit user confirmation in the client before
                       they're allowed to execute. Every tool today is read-only.
  - `handler`        → async (db, user, *, transcript, thread_id, content_id,
                       args) -> {"answer": str, "citations": list, "thread_id"?}.
  - `args_schema`    → optional JSON-schema for structured arguments the planner
                       can extract (foundation for richer tools; unused today).
"""
from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import Digest, DigestItem, User
from briefly_api.services.browser_capture import list_recent_captures
from briefly_api.utils.dates import local_date_string

ToolHandler = Callable[..., Awaitable[dict]]


@dataclass(frozen=True)
class OrbTool:
    name: str
    description: str
    handler: ToolHandler
    side_effect: str = "read"  # "read" | "write"
    fast_patterns: tuple[re.Pattern[str], ...] = ()
    args_schema: dict[str, Any] | None = None

    def matches(self, text: str) -> bool:
        return any(p.search(text) for p in self.fast_patterns)


# ── Read-only data-tool handlers ─────────────────────────────────────────────


async def today_brief_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str = "",
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    # Digests are stored under the user's LOCAL date (the pipeline uses their
    # digest timezone), so match that — not the UTC date — or we miss today's
    # brief whenever the user's timezone has crossed midnight relative to UTC.
    profile = getattr(user, "profile", None)
    tz = getattr(profile, "digest_timezone", None) or "UTC"
    today = local_date_string(tz)
    digest = (
        await db.execute(
            select(Digest).where(Digest.user_id == user.id, Digest.digest_date == today)
        )
    ).scalar_one_or_none()
    if digest is None:
        # Fall back to the most recent digest — covers midnight/timezone edges
        # and "give me my latest briefing".
        digest = (
            await db.execute(
                select(Digest)
                .where(Digest.user_id == user.id)
                .order_by(Digest.digest_date.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
    if not digest:
        return {
            "answer": "Your briefing isn't ready yet. Ask me again in a few minutes.",
            "citations": [],
        }
    items = (
        await db.execute(
            select(DigestItem)
            .where(DigestItem.digest_id == digest.id)
            .order_by(DigestItem.position.asc())
            .limit(5)
        )
    ).scalars().all()
    if not items:
        return {
            "answer": "Your briefing exists but has no items yet. It may still be generating.",
            "citations": [],
        }
    lines = ["Here are the top items in your briefing today:"]
    cites: list[dict] = []
    for i, it in enumerate(items, start=1):
        lines.append(f"{i}. {it.headline}")
        cites.append(
            {
                "ref": f"S{i}",
                "content_id": it.content_id or f"digest-item:{it.id}",
                "title": it.headline,
                "url": it.source_url,
                "source_name": it.source_name,
                "snippet": (it.summary or "")[:280],
                "kind": "today_brief",
            }
        )
    return {"answer": " ".join(lines), "citations": cites}


async def saved_queue_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str = "",
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    captures = await list_recent_captures(db, user.id, limit=5)
    if not captures:
        return {"answer": "Your saved queue is clear — there are no unread items right now.", "citations": []}
    lines = ["You have saved items waiting:"]
    cites: list[dict] = []
    for i, cap in enumerate(captures, start=1):
        lines.append(f"{i}. {cap.title}")
        cites.append(
            {
                "ref": f"S{i}",
                "content_id": cap.id,
                "title": cap.title,
                "url": cap.url,
                "source_name": "Saved",
                "snippet": (cap.summary or "")[:280],
                "kind": "saved_item",
            }
        )
    return {"answer": " ".join(lines), "citations": cites}


async def proactive_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str = "",
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    from briefly_api.agents.proactive.proactive_surfacing import get_for_api

    events = await get_for_api(db, user.id)
    if not events:
        return {
            "answer": "No urgent proactive updates right now. I'll surface important changes when they appear.",
            "citations": [],
        }
    top = sorted(events, key=lambda e: int(e.get("priority") or 0), reverse=True)[:3]
    lines = ["Here are the most important updates right now:"]
    cites: list[dict] = []
    for i, ev in enumerate(top, start=1):
        lines.append(f"{i}. {ev.get('title')}: {ev.get('body')}")
        cites.append(
            {
                "ref": f"S{i}",
                "content_id": ev.get("id", ""),
                "title": ev.get("title", "Proactive event"),
                "url": None,
                "source_name": "Proactive",
                "snippet": str(ev.get("body") or "")[:280],
                "kind": "proactive_event",
            }
        )
    return {"answer": " ".join(lines), "citations": cites}


async def web_search_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str = "",
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    from briefly_api.services.web_search import web_search

    query = ((args or {}).get("query") or transcript or "").strip()
    if not query:
        return {"answer": "What would you like me to look up on the web?", "citations": []}

    results = await web_search(query)
    if not results:
        return {
            "answer": "Web search isn't enabled, so I can only answer from your own sources right now.",
            "citations": [],
        }

    lines = ["Here's what I found on the web — note this is the open web, not your own sources:"]
    cites: list[dict] = []
    for i, r in enumerate(results, start=1):
        lines.append(f"{i}. {r['title']}")
        cites.append(
            {
                "ref": f"S{i}",
                "content_id": "",
                "title": r["title"],
                "url": r.get("url"),
                "source_name": "Web",
                "snippet": (r.get("snippet") or "")[:280],
                "kind": "web_search",
            }
        )
    return {"answer": " ".join(lines), "citations": cites}


# ── Registry of orb tools ─────────────────────────────────────────────────────
# (ask_briefly is registered in services/orb.py, where the patchable brain lives.)

DATA_TOOLS: list[OrbTool] = [
    OrbTool(
        name="today_brief",
        description="Fetch today's briefing items and summarize key headlines.",
        handler=today_brief_handler,
        fast_patterns=(
            re.compile(r"(?:today(?:'s)?\s+(?:brief|briefing|briefs)|brief(?:ing)?\s+today)", re.IGNORECASE),
        ),
    ),
    OrbTool(
        name="saved_queue",
        description="Fetch saved/unread queue items the user has not read.",
        handler=saved_queue_handler,
        fast_patterns=(
            re.compile(r"(?:saved|unread|reading\s+list|backlog|queue)", re.IGNORECASE),
        ),
    ),
    OrbTool(
        name="proactive_events",
        description="Fetch high-priority proactive events to surface now.",
        handler=proactive_handler,
        fast_patterns=(
            re.compile(r"(?:anything\s+important|proactive|alerts?|urgent|what\s+should\s+i\s+know)", re.IGNORECASE),
        ),
    ),
    OrbTool(
        name="web_search",
        description=(
            "Search the public web for current facts or info NOT in the user's own "
            "sources. Use ONLY for explicit web/internet requests, or when the user's "
            "corpus clearly cannot answer — prefer the user's own sources otherwise."
        ),
        handler=web_search_handler,
        fast_patterns=(
            re.compile(r"\b(search|look\s*up|find|pull|fetch)\b.{0,40}\b(web|internet|online|google)\b", re.IGNORECASE),
            re.compile(r"\b(on|from|across|over)\s+the\s+(web|internet)\b", re.IGNORECASE),
            re.compile(r"\bweb\s*search\b", re.IGNORECASE),
            re.compile(r"\bgoogle\s+(it|this|that|for)\b", re.IGNORECASE),
        ),
        args_schema={"query": "what to search the web for"},
    ),
]
