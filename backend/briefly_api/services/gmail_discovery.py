"""
briefly_api/services/gmail_discovery.py

Gmail inbox footprint — discovers newsletter senders from real message metadata.
Every candidate traces to an actual email in the user's inbox.
"""
from __future__ import annotations

import asyncio
import logging
import re
from collections import Counter

import httpx

log = logging.getLogger(__name__)

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

_QUERIES = [
    "has:list-unsubscribe newer_than:365d",
    (
        "newer_than:365d (from:substack.com OR from:beehiiv.com OR from:mail.beehiiv.com OR "
        "from:convertkit.com OR from:buttondown.email OR from:ghost.io OR "
        "from:mailchimp.com OR from:medium.com OR from:noreply@medium.com)"
    ),
    'newer_than:365d subject:(newsletter OR digest OR weekly OR roundup OR changelog OR briefing)',
    "newer_than:180d label:promotions",
    "newer_than:180d category:promotions",
]

_QUERY_BROAD = "newer_than:90d -from:me"

_SKIP_SENDER_DOMAINS = frozenset({
    "gmail.com", "google.com", "googlemail.com", "yahoo.com", "outlook.com",
    "hotmail.com", "icloud.com", "me.com", "protonmail.com", "live.com",
})

_SUBJECT_NEWSLETTER_RE = re.compile(
    r"\b(newsletter|digest|weekly|roundup|changelog|briefing|issue\s+#|edition)\b",
    re.I,
)


def _parse_sender(from_header: str) -> tuple[str, str] | None:
    from_header = from_header.strip()
    match = re.match(r'^(?:"?([^"<>]+?)"?\s*)?<?([^<>\s@]+@[^<>\s@]+)>?$', from_header)
    if not match:
        return None
    raw_name = (match.group(1) or "").strip(" \"'")
    email = match.group(2).lower()
    name = raw_name or email.split("@")[0]
    return name, email


def _headers_map(payload: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for h in payload.get("headers", []):
        name = (h.get("name") or "").lower()
        if name:
            out[name] = h.get("value") or ""
    return out


def _is_newsletter_message(headers: dict[str, str]) -> bool:
    if headers.get("list-unsubscribe") or headers.get("list-id"):
        return True
    precedence = (headers.get("precedence") or "").lower()
    if precedence in {"bulk", "list", "junk"}:
        return True
    from_val = headers.get("from", "").lower()
    if any(p in from_val for p in (
        "substack", "beehiiv", "mailchimp", "convertkit", "buttondown",
        "medium.com", "ghost.io", "newsletter", "digest", "noreply",
    )):
        return True
    if _SUBJECT_NEWSLETTER_RE.search(headers.get("subject", "")):
        return True
    return False


def substack_feed_from_headers(headers: dict[str, str], sender_email: str) -> str | None:
    list_id = headers.get("list-id", "")
    for blob in (list_id, sender_email):
        match = re.search(r"([a-z0-9-]+)\.substack\.com", blob, re.I)
        if match:
            return f"https://{match.group(1).lower()}.substack.com/feed"
    domain = sender_email.split("@")[-1].lower() if "@" in sender_email else ""
    if domain.endswith(".substack.com"):
        return f"https://{domain}/feed"
    return None


def _list_messages(access_token: str, query: str, *, max_messages: int = 400) -> list[str]:
    headers = {"Authorization": f"Bearer {access_token}"}
    ids: list[str] = []
    page_token: str | None = None

    with httpx.Client(timeout=45.0, headers=headers) as client:
        while len(ids) < max_messages:
            params: dict[str, str] = {"q": query, "maxResults": "100"}
            if page_token:
                params["pageToken"] = page_token
            resp = client.get(f"{GMAIL_API}/messages", params=params)
            resp.raise_for_status()
            data = resp.json()
            ids.extend(m["id"] for m in data.get("messages", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break

    return ids[:max_messages]


def _collect_message_ids(access_token: str, max_results: int) -> list[str]:
    seen: set[str] = set()
    all_ids: list[str] = []

    for query in _QUERIES:
        try:
            for mid in _list_messages(access_token, query, max_messages=max_results):
                if mid not in seen:
                    seen.add(mid)
                    all_ids.append(mid)
        except Exception as exc:
            log.debug("Gmail query failed (%s…): %s", query[:50], exc)

    if len(all_ids) < 8:
        try:
            for mid in _list_messages(access_token, _QUERY_BROAD, max_messages=max_results):
                if mid not in seen:
                    seen.add(mid)
                    all_ids.append(mid)
        except Exception as exc:
            log.debug("Gmail broad query failed: %s", exc)

    return all_ids


def _discover_senders_sync(access_token: str, max_results: int = 400) -> list[dict]:
    message_ids = _collect_message_ids(access_token, max_results)
    if not message_ids:
        log.warning("Gmail discovery: 0 messages matched any query")
        return {"senders": [], "messages_scanned": 0}  # type: ignore[return-value]

    counts: Counter[str] = Counter()
    meta: dict[str, dict] = {}
    headers_auth = {"Authorization": f"Bearer {access_token}"}

    with httpx.Client(timeout=120.0, headers=headers_auth) as client:
        for msg_id in message_ids:
            try:
                resp = client.get(
                    f"{GMAIL_API}/messages/{msg_id}",
                    params={
                        "format": "metadata",
                        "metadataHeaders": ["From", "Subject", "List-Unsubscribe", "List-Id", "Precedence"],
                    },
                )
                resp.raise_for_status()
                hdrs = _headers_map(resp.json().get("payload", {}))
                if not _is_newsletter_message(hdrs):
                    continue

                from_val = hdrs.get("from")
                if not from_val:
                    continue
                parsed = _parse_sender(from_val)
                if not parsed:
                    continue
                name, email = parsed
                if email.split("@")[-1] in _SKIP_SENDER_DOMAINS:
                    continue

                counts[email] += 1
                if email not in meta:
                    meta[email] = {
                        "name": name,
                        "email": email,
                        "sample_subject": hdrs.get("subject", "")[:120],
                        "substack_feed": substack_feed_from_headers(hdrs, email),
                    }
            except Exception:
                continue

    senders = [
        {
            "email": email,
            "name": meta[email]["name"],
            "count": count,
            "sample_subject": meta[email].get("sample_subject", ""),
            "substack_feed": meta[email].get("substack_feed"),
        }
        for email, count in counts.most_common(60)
        if email in meta
    ]

    log.info(
        "Gmail discovery: scanned %d messages → %d newsletter senders",
        len(message_ids), len(senders),
    )
    return {"senders": senders, "messages_scanned": len(message_ids)}


async def discover_newsletter_senders(
    access_token: str,
    already_added: set[str],
    max_results: int = 400,
) -> tuple[list[dict], int]:
    """
    Return (newsletter senders, messages_scanned).
    Each sender was found in the user's real Gmail inbox.
    """
    result = await asyncio.to_thread(_discover_senders_sync, access_token, max_results)
    if isinstance(result, list):
        # backward compat
        raw, scanned = result, 0
    else:
        raw = result["senders"]
        scanned = result["messages_scanned"]

    already_lower = {a.lower() for a in already_added}
    filtered = [s for s in raw if s["email"] not in already_lower]
    log.info(
        "Gmail discovery: %d senders (%d messages scanned), %d new after filter",
        len(raw), scanned, len(filtered),
    )
    return filtered, scanned
