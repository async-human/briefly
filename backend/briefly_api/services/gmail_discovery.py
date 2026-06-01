"""
briefly_api/services/gmail_discovery.py

Scans a user's Gmail inbox for newsletter senders they haven't added yet.
Uses metadata-only fetches (no message body download) so it is fast and
doesn't consume much Gmail API quota.

Returns a ranked list of {email, name, count} objects — the ones with the
highest frequency are shown first so the most-read newsletters appear at
the top of the suggestion list.
"""
from __future__ import annotations

import asyncio
import re
from collections import Counter

import httpx

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

# Broad query: newsletter-like senders + List-Unsubscribe header presence.
# We request metadata-only messages (headers only) — very cheap API call.
_DISCOVERY_QUERY = (
    "has:list-unsubscribe OR "
    "from:substack.com OR from:beehiiv.com OR from:mail.beehiiv.com OR "
    "from:convertkit.com OR from:buttondown.email OR from:ghost.io OR "
    "from:mailchimp.com OR from:constantcontact.com OR from:campaignmonitor.com OR "
    "from:noreply@medium.com OR from:medium.com OR from:newsletter OR "
    'subject:(digest OR weekly OR changelog OR roundup OR newsletter OR "this week" OR briefing) OR '
    "label:newsletters OR category:promotions"
)

# Broader fallback when the strict query returns nothing
_DISCOVERY_QUERY_FALLBACK = (
    "newer_than:365d "
    "(from:substack OR from:beehiiv OR from:medium OR has:list-unsubscribe OR "
    'subject:(newsletter OR digest OR weekly))'
)


def _parse_sender(from_header: str) -> tuple[str, str] | None:
    """Return (display_name, email) or None if unparseable."""
    from_header = from_header.strip()
    match = re.match(r'^(?:"?([^"<>]+?)"?\s*)?<?([^<>\s@]+@[^<>\s@]+)>?$', from_header)
    if not match:
        return None
    raw_name = (match.group(1) or "").strip(" \"'")
    email = match.group(2).lower()
    name = raw_name or email.split("@")[0]
    return name, email


def _discover_senders_sync(access_token: str, max_results: int = 200, query: str | None = None) -> list[dict]:
    """
    Fetch up to max_results newsletter message headers, extract unique senders,
    return [{name, email, count}] sorted by count desc.
    """
    headers = {"Authorization": f"Bearer {access_token}"}

    # Step 1: list message IDs (metadata format — no body, very fast)
    params = {
        "q": query or _DISCOVERY_QUERY,
        "maxResults": str(max_results),
        "format": "metadata",
    }
    with httpx.Client(timeout=30.0, headers=headers) as client:
        resp = client.get(f"{GMAIL_API}/messages", params=params)
        resp.raise_for_status()
        data = resp.json()

    message_ids = [m["id"] for m in data.get("messages", [])]
    if not message_ids:
        return []

    # Step 2: batch-fetch metadata (From header only) for all messages
    sender_counter: Counter[str] = Counter()
    sender_names: dict[str, str] = {}

    with httpx.Client(timeout=60.0, headers=headers) as client:
        for msg_id in message_ids:
            try:
                resp = client.get(
                    f"{GMAIL_API}/messages/{msg_id}",
                    params={"format": "metadata", "metadataHeaders": "From"},
                )
                resp.raise_for_status()
                msg_data = resp.json()

                payload_headers = msg_data.get("payload", {}).get("headers", [])
                from_val = next(
                    (h["value"] for h in payload_headers if h.get("name", "").lower() == "from"),
                    None,
                )
                if not from_val:
                    continue

                parsed = _parse_sender(from_val)
                if not parsed:
                    continue
                name, email = parsed
                sender_counter[email] += 1
                if email not in sender_names:
                    sender_names[email] = name
            except Exception:
                continue

    return [
        {"email": email, "name": sender_names[email], "count": count}
        for email, count in sender_counter.most_common(50)
    ]


async def discover_newsletter_senders(
    access_token: str,
    already_added: set[str],
    max_results: int = 200,
) -> list[dict]:
    """
    Async wrapper. Filters out senders already added as sources.
    Returns [{email, name, count}] ready for the API response.
    """
    raw = await asyncio.to_thread(_discover_senders_sync, access_token, max_results)
    if not raw:
        raw = await asyncio.to_thread(
            _discover_senders_sync, access_token, max_results, _DISCOVERY_QUERY_FALLBACK,
        )
    already_lower = {a.lower() for a in already_added}
    return [s for s in raw if s["email"] not in already_lower]
