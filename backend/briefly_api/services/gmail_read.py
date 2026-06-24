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
        return str(args["query"]).strip()
    text = (transcript or "").strip()
    for pat in (
        r"\b(?:search|find)\s+(?:my\s+)?(?:email|emails|mail|gmail)\s+(?:for|about)\s+(.+?)(?:\?|$)",
        r"\bemails?\s+about\s+(.+?)(?:\?|$)",
        r"\b(?:any|show)\s+emails?\s+(?:from|about)\s+(.+?)(?:\?|$)",
    ):
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1).strip().rstrip(".")
    cleaned = re.sub(
        r"^(please\s+)?(search|find|check)\s+(my\s+)?(gmail|email|emails|inbox)\s*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()
    return cleaned or text
