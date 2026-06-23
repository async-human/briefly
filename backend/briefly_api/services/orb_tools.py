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

from briefly_api.db.models import Digest, DigestItem, RawContent, User
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


async def draft_email_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str = "",
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    """Draft a grounded email. Creates a reviewable draft only — never sends.
    Sending stays behind the explicit review-card confirmation."""
    from briefly_api.services.email_drafts import compose_email_draft

    instruction = ((args or {}).get("instruction") or transcript or "").strip()
    if not instruction:
        return {"answer": "What should the email say, and who's it for?", "citations": []}

    draft = await compose_email_draft(db, user, instruction, content_id=content_id)

    # What it was grounded in — for spoken context + citations the orb can show.
    titles: list[str] = []
    ids = list(draft.source_content_ids or [])
    if ids:
        rows = (
            await db.execute(select(RawContent.title).where(RawContent.id.in_(ids)).limit(5))
        ).all()
        titles = [(t or "").strip() for (t,) in rows if t and t.strip()]
    grounded = (
        f" I based it on {len(titles)} thing{'s' if len(titles) != 1 else ''} you've read."
        if titles
        else ""
    )

    src_note = f" · based on {len(titles)} source{'s' if len(titles) != 1 else ''}" if titles else ""
    return {
        "answer": (
            f'Here\'s a draft, subject "{draft.subject}".{grounded} {draft.body} '
            "Want me to change anything, or should I send it?"
        ),
        # Concise, actionable line for the screen — not the whole body.
        "display": (
            f'Draft ready — "{draft.subject}"{src_note}.\n'
            "Say “send it”, “make changes”, or “save to drafts”."
        ),
        "citations": [{"title": t} for t in titles],
        "expects_reply": True,
    }


async def revise_email_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str = "",
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    """Revise the in-progress draft by voice ('make it shorter', 'add a line about X')."""
    from briefly_api.services.email_drafts import get_active_draft, revise_email_draft

    draft = await get_active_draft(db, user.id)
    if not draft:
        return {
            "answer": "I don't have a recent draft open to change. Want me to draft an email first?",
            "citations": [],
            "expects_reply": True,
        }
    revision = ((args or {}).get("revision") or transcript or "").strip()
    draft = await revise_email_draft(db, user, draft, revision)
    return {
        "answer": (
            f"Updated. Subject: {draft.subject}. {draft.body} "
            "Anything else, or should I send it?"
        ),
        "display": (
            f'Updated — "{draft.subject}".\n'
            "Say “send it”, “make more changes”, or “save to drafts”."
        ),
        "citations": [],
        "expects_reply": True,
    }


async def save_email_to_gmail_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str = "",
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    """Drop the in-progress draft into the user's Gmail drafts (never sends)."""
    from datetime import datetime, timezone

    from briefly_api.auth.gmail import (
        GmailAccessError,
        create_gmail_draft,
        get_gmail_connection,
        gmail_connection_can_create_draft,
    )
    from briefly_api.config import get_settings
    from briefly_api.services.email_drafts import get_active_draft

    draft = await get_active_draft(db, user.id)
    if not draft:
        return {"answer": "I don't have a draft ready to save. Want me to draft one?", "citations": []}

    conn = await get_gmail_connection(db, user.id)
    if not gmail_connection_can_create_draft(conn):
        return {
            "answer": (
                "I can write the draft, but to drop it into your Gmail you'll need to "
                "connect Gmail once in Briefly settings."
            ),
            "citations": [],
        }
    try:
        await create_gmail_draft(
            conn,
            get_settings(),
            to=draft.to_email,
            subject=draft.subject,
            body=draft.body,
            from_email=conn.account_email,
        )
    except GmailAccessError:
        return {"answer": "I couldn't save it to Gmail — you may need to reconnect Gmail in settings.", "citations": []}

    draft.status = "drafted_to_gmail"
    draft.sent_at = datetime.now(timezone.utc)
    await db.commit()
    return {"answer": "Done — it's in your Gmail drafts, ready for you to review and send.", "citations": []}


def _extract_recipient(transcript: str) -> tuple[str, str | None]:
    """Pull a recipient from a spoken send command. Returns (name, explicit_email)."""
    text = transcript or ""
    email_match = re.search(r"[\w.+-]+@[\w.-]+\.\w+", text)
    if email_match:
        return "", email_match.group(0)
    m = re.search(r"\b(?:to|for)\s+([A-Za-z][\w.'-]*(?:\s+[A-Za-z][\w.'-]*)?)", text, re.IGNORECASE)
    name = m.group(1).strip() if m else ""
    # Drop trailing filler so "to John about pricing" → "John".
    name = re.sub(r"\s+(about|regarding|saying|that|and|with)\b.*$", "", name, flags=re.IGNORECASE).strip()
    return name, None


async def send_email_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str = "",
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    """Resolve a named recipient from Gmail history and stage the send. Does NOT
    send — it sets up an explicit spoken confirmation (human-in-the-loop)."""
    from briefly_api.auth.gmail import (
        get_gmail_connection,
        gmail_connection_can_send,
        refresh_gmail_access_token,
        search_contact_email,
    )
    from briefly_api.config import get_settings
    from briefly_api.services.email_drafts import get_active_draft

    draft = await get_active_draft(db, user.id)
    if not draft:
        return {"answer": "I don't have a draft ready to send. Want me to draft one first?", "citations": []}

    conn = await get_gmail_connection(db, user.id)
    if not gmail_connection_can_send(conn):
        return {
            "answer": "To send on your behalf you'll need to connect Gmail once in Briefly settings.",
            "citations": [],
        }

    requested = ((args or {}).get("recipient") or transcript or "").strip()
    name, explicit_email = _extract_recipient(requested)
    to_email, to_name = explicit_email, (name or None)

    if not to_email:
        if not name:
            return {"answer": "Who should I send it to? Say a name from your contacts.", "citations": [], "expects_reply": True}
        try:
            token = await refresh_gmail_access_token(conn, get_settings())
            match = await search_contact_email(token, name)
        except Exception:
            match = None
        if not match:
            return {
                "answer": f"I couldn't find an email for {name} in your Gmail. Say the address, or try another name.",
                "citations": [],
                "expects_reply": True,
            }
        to_email, to_name = match[0], (match[1] or name)

    draft.to_email = to_email
    draft.to_name = to_name
    draft.status = "pending_send"
    await db.commit()
    who = to_name or to_email
    return {
        "answer": f"I'll send this to {who} at {to_email}. Say 'confirm' to send, or 'cancel'.",
        "display": f"Send to {who}?\n{to_email}\nSay “confirm” or “cancel”.",
        "citations": [],
        "expects_reply": True,
    }


async def confirm_send_handler(
    db: AsyncSession,
    user: User,
    *,
    transcript: str = "",
    thread_id: str | None = None,
    content_id: str | None = None,
    args: dict | None = None,
) -> dict:
    """Confirm or cancel the email awaiting send. The actual send happens HERE, only
    after the user's explicit confirmation — the human-in-the-loop gate."""
    from datetime import datetime as _dt
    from datetime import timezone as _tz

    from sqlalchemy import func

    from briefly_api.auth.gmail import (
        GmailAccessError,
        gmail_connection_can_send,
        get_gmail_connection,
        send_gmail_message,
    )
    from briefly_api.config import get_settings
    from briefly_api.db.models import EmailDraft
    from briefly_api.services.email_drafts import get_pending_send_draft

    draft = await get_pending_send_draft(db, user.id)
    if not draft:
        return {"answer": "There's nothing waiting to send right now.", "citations": []}

    if re.search(r"\b(cancel|don'?t send|do not send|never\s?mind|stop|hold on)\b", transcript, re.IGNORECASE):
        draft.status = "draft"
        await db.commit()
        return {"answer": "Okay, I won't send it. It's still here if you want to change it.", "citations": []}

    s = get_settings()
    conn = await get_gmail_connection(db, user.id)
    if not gmail_connection_can_send(conn):
        return {"answer": "I can't send — Gmail isn't connected for sending.", "citations": []}

    today = _dt.now(_tz.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    sent_today = (
        await db.execute(
            select(func.count())
            .select_from(EmailDraft)
            .where(
                EmailDraft.user_id == user.id,
                EmailDraft.status == "sent",
                EmailDraft.sent_at >= today,
            )
        )
    ).scalar() or 0
    if sent_today >= s.act_email_daily_cap:
        return {
            "answer": f"You've hit today's send limit of {s.act_email_daily_cap} emails. Try again tomorrow.",
            "citations": [],
        }

    try:
        await send_gmail_message(
            conn, s, to=draft.to_email, subject=draft.subject, body=draft.body, from_email=conn.account_email
        )
    except GmailAccessError:
        return {"answer": "I couldn't send it — you may need to reconnect Gmail in settings.", "citations": []}

    draft.status = "sent"
    draft.sent_at = _dt.now(_tz.utc)
    await db.commit()
    return {"answer": f"Sent to {draft.to_name or draft.to_email}.", "citations": []}


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
    OrbTool(
        name="draft_email",
        description=(
            "Draft an email/note/reply on the user's behalf, grounded in what they've "
            "read. Use when the user asks to write, draft, or compose an email, note, or "
            "message to someone. Creates a reviewable draft and reads it back; never sends."
        ),
        handler=draft_email_handler,
        side_effect="write",
        fast_patterns=(
            re.compile(r"\b(draft|write|compose)\b.{0,30}\b(e-?mail|note|message|reply)\b", re.IGNORECASE),
            re.compile(r"\be-?mail\s+(to|him|her|them|my|the|a)\b", re.IGNORECASE),
        ),
        args_schema={"instruction": "what the email should say and to whom"},
    ),
    OrbTool(
        name="revise_email",
        description=(
            "Revise the email draft currently in progress — shorten, reword, change tone, "
            "or add/remove a point. Use when the user asks to change/edit the draft they "
            "just made (it operates on their most recent draft)."
        ),
        handler=revise_email_handler,
        side_effect="write",
        fast_patterns=(
            re.compile(r"\b(make|keep)\s+it\b.{0,30}\b(short|shorter|brief|briefer|concise|long|longer|formal|casual|friendly|warm|direct|punchy)\b", re.IGNORECASE),
            re.compile(r"\b(shorten|reword|rephrase|rewrite|simplify|tighten)\b", re.IGNORECASE),
            re.compile(r"\b(change|edit|revise|tweak|adjust|fix)\b.{0,20}\b(it|the\s+(e-?mail|draft|message|note|wording|tone|subject|line))\b", re.IGNORECASE),
            re.compile(r"\b(add|remove|drop|take\s+out|include|mention)\b.{0,40}\b(line|sentence|paragraph|part|point|bit)\b", re.IGNORECASE),
            re.compile(r"^\s*(shorter|longer|more\s+(formal|casual|concise|friendly|direct))\s*$", re.IGNORECASE),
        ),
        args_schema={"revision": "what to change about the draft"},
    ),
    OrbTool(
        name="save_email_to_gmail",
        description=(
            "Save the in-progress email draft into the user's Gmail drafts so they can "
            "send it from Gmail. Use for 'save it', 'put it in my drafts', 'add to Gmail'."
        ),
        handler=save_email_to_gmail_handler,
        side_effect="write",
        fast_patterns=(
            re.compile(r"\b(save|put|drop|add|stick)\b.{0,25}\b(draft|drafts|gmail)\b", re.IGNORECASE),
            re.compile(r"\bsave\s+it\b", re.IGNORECASE),
        ),
    ),
    OrbTool(
        name="send_email",
        description=(
            "Stage sending the in-progress draft to a named recipient (resolved from the "
            "user's Gmail history). Sets up a spoken confirmation — it does NOT send until "
            "the user confirms. Use for 'send it to <name>', 'email this to <name>'."
        ),
        handler=send_email_handler,
        side_effect="write",
        fast_patterns=(
            re.compile(r"\bsend\b.{0,40}\bto\b\s+[A-Za-z@]", re.IGNORECASE),
            re.compile(r"\b(send|e-?mail|shoot)\b.{0,25}\b(it|this|that|the\s+(e-?mail|draft|message))\b.{0,15}\bto\b", re.IGNORECASE),
        ),
        args_schema={"recipient": "name or email address to send to"},
    ),
    OrbTool(
        name="confirm_send",
        description=(
            "Confirm or cancel the email that is pending the user's send-confirmation. The "
            "actual send happens here. Use for 'confirm', 'send it now', 'go ahead', "
            "'cancel', 'don't send'."
        ),
        handler=confirm_send_handler,
        side_effect="write",
        fast_patterns=(
            re.compile(r"\bconfirm\b", re.IGNORECASE),
            re.compile(r"\b(go ahead|send it now|send now|yes,?\s+send)\b", re.IGNORECASE),
            re.compile(r"^\s*send it\s*$", re.IGNORECASE),
            re.compile(r"\b(cancel|don'?t send|do not send|never\s?mind)\b", re.IGNORECASE),
        ),
    ),
]
