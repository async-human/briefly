"""Read-only Gmail helpers for the voice orb."""
from __future__ import annotations

import base64
import logging
import re

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.gmail import GMAIL_API, get_gmail_connection, refresh_gmail_access_token
from briefly_api.config import get_settings

log = logging.getLogger(__name__)


def _header(headers: list[dict], name: str) -> str:
    target = name.lower()
    for h in headers or []:
        if str(h.get("name") or "").lower() == target:
            return str(h.get("value") or "").strip()
    return ""


def _decode_snippet(payload: dict) -> str:
    snippet = str(payload.get("snippet") or "").strip()
    if snippet:
        return snippet[:280]
    parts = payload.get("parts") or []
    for part in parts:
        body = part.get("body") or {}
        data = body.get("data")
        if data:
            try:
                raw = base64.urlsafe_b64decode(data + "==")
                text = raw.decode("utf-8", errors="replace")
                if text.strip():
                    return text.strip()[:280]
            except Exception:
                pass
    return ""


async def _list_message_ids(token: str, *, q: str = "", max_results: int = 5) -> list[str]:
    params: dict[str, str | int] = {"maxResults": max(1, min(max_results, 10))}
    if q:
        params["q"] = q
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            f"{GMAIL_API}/messages",
            headers={"Authorization": f"Bearer {token}"},
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()
    return [str(m["id"]) for m in (data.get("messages") or []) if m.get("id")]


async def _fetch_message(token: str, message_id: str) -> dict | None:
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            f"{GMAIL_API}/messages/{message_id}",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "format": "metadata",
                "metadataHeaders": ["Subject", "From", "Date"],
            },
        )
        if resp.status_code != 200:
            return None
        payload = resp.json()
    headers = (payload.get("payload") or {}).get("headers") or []
    return {
        "id": message_id,
        "subject": _header(headers, "Subject") or "(no subject)",
        "from": _header(headers, "From"),
        "date": _header(headers, "Date"),
        "snippet": _decode_snippet(payload),
    }


async def list_recent_emails(db: AsyncSession, user_id: str, *, limit: int = 5) -> list[dict]:
    conn = await get_gmail_connection(db, user_id)
    if conn is None:
        return []
    settings = get_settings()
    try:
        token = await refresh_gmail_access_token(conn, settings)
        ids = await _list_message_ids(token, max_results=limit)
        out: list[dict] = []
        for mid in ids:
            msg = await _fetch_message(token, mid)
            if msg:
                out.append(msg)
        return out
    except Exception:
        log.exception("gmail list_recent failed user=%s", user_id)
        return []


async def search_emails(
    db: AsyncSession,
    user_id: str,
    query: str,
    *,
    limit: int = 5,
) -> list[dict]:
    conn = await get_gmail_connection(db, user_id)
    if conn is None:
        return []
    settings = get_settings()
    try:
        token = await refresh_gmail_access_token(conn, settings)
        ids = await _list_message_ids(token, q=query, max_results=limit)
        out: list[dict] = []
        for mid in ids:
            msg = await _fetch_message(token, mid)
            if msg:
                out.append(msg)
        return out
    except Exception:
        log.exception("gmail search failed user=%s q=%r", user_id, query)
        return []


def extract_gmail_search_query(transcript: str, args: dict | None) -> str:
    if args and args.get("query"):
        return _clean_gmail_query(str(args["query"]))
    text = (transcript or "").strip()
    for pat in (
        r"\b(?:search|find)\s+(?:my\s+)?(?:email|emails|mail|gmail)\s+(?:for|about)\s+(.+?)(?:\?|$)",
        r"\bemails?\s+about\s+(.+?)(?:\?|$)",
        r"\b(?:any|show|got)?\s*emails?\s+(?:from|by)\s+(.+?)(?:\?|$)",
        r"\b(?:mail|messages?)\s+from\s+(.+?)(?:\?|$)",
    ):
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return _clean_gmail_query(m.group(1))
    cleaned = re.sub(
        r"^(please\s+)?(search|find|check)\s+(my\s+)?(gmail|email|emails|inbox)\s*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    return _clean_gmail_query(cleaned or text)


def _clean_gmail_query(query: str) -> str:
    q = (query or "").strip().strip(".,!?")
    q = q.lstrip(",").strip()
    q = re.sub(r"\b(maybe|perhaps|please|got it|any|some)\b", "", q, flags=re.IGNORECASE)
    q = re.sub(r"\s+", " ", q).strip()
    if not q:
        return ""
    if ":" in q:
        return q
    if q.lower().startswith("from "):
        sender = q[5:].strip()
        return f"from:{sender}" if sender else q
    return q


async def resolve_gmail_search_query(
    transcript: str,
    args: dict | None = None,
    *,
    user_id: str | None = None,
) -> str:
    """Build a Gmail API q= string from the user utterance via LLM."""
    if args and args.get("query"):
        cleaned = _clean_gmail_query(str(args["query"]))
        if cleaned:
            return cleaned

    text = (transcript or "").strip()
    if not text:
        return ""

    heuristic = extract_gmail_search_query(text, args)
    if heuristic and heuristic.startswith("from:"):
        return heuristic

    from briefly_api.llm.adapter import Message, get_llm_adapter

    llm = get_llm_adapter()
    prompt = (
        f"User request (voice): {text}\n\n"
        "Return JSON: {\"query\": \"<gmail search string>\"}\n"
        "Use Gmail search operators: from:, subject:, newer_than:7d, is:unread.\n"
        "For 'emails from Acme Corp' use from:acme or from:\"Acme Corp\".\n"
        "Strip filler words (maybe, got it, please). No explanation."
    )
    try:
        data = await llm.complete_json(
            [Message(role="user", content=prompt)],
            system="You convert spoken email search requests into Gmail search query strings.",
            max_tokens=80,
            user_id=user_id,
            agent="gmail_query",
        )
        if isinstance(data, dict) and data.get("query"):
            cleaned = _clean_gmail_query(str(data["query"]))
            if cleaned:
                return cleaned
    except Exception:
        log.debug("LLM gmail query build failed", exc_info=True)

    return heuristic
