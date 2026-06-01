from __future__ import annotations

import asyncio
import base64
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import html2text
import httpx

from briefly_api.config import Settings
from briefly_api.db.models import OAuthConnection
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.article_urls import resolve_article_url, strip_url_noise
from briefly_api.services.medium_extractor import (
    detect_medium_digest,
    extract_article_urls,
)
from briefly_api.services.newsletter_link_extractor import extract_outbound_links

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

NEWSLETTER_QUERY = (
    "label:newsletters OR "
    "from:substack.com OR from:beehiiv.com OR from:mail.beehiiv.com OR "
    "from:convertkit.com OR from:buttondown.email OR "
    "from:medium.com OR from:noreply@medium.com OR "
    'subject:(newsletter OR digest OR "weekly issue")'
)

_HTML_CONVERTER = html2text.HTML2Text()
_HTML_CONVERTER.ignore_links = False
_HTML_CONVERTER.ignore_images = True


def _decode_b64url(data: str) -> str:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding).decode("utf-8", errors="replace")


def _header_value(headers: list[dict], name: str) -> str:
    for header in headers:
        if header.get("name", "").lower() == name.lower():
            return header.get("value", "")
    return ""


def _extract_raw_html(payload: dict) -> str | None:
    """Return the raw HTML body of an email without any conversion."""
    mime = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data")
    if body_data and "html" in mime:
        return _decode_b64url(body_data)

    for part in payload.get("parts", []):
        part_mime = part.get("mimeType", "")
        if part_mime.startswith("multipart/"):
            nested = _extract_raw_html(part)
            if nested:
                return nested
        if part_mime == "text/html":
            data = part.get("body", {}).get("data")
            if data:
                return _decode_b64url(data)
    return None


def _extract_body(payload: dict) -> str:
    mime = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data")
    if body_data:
        text = _decode_b64url(body_data)
        if "html" in mime:
            return _HTML_CONVERTER.handle(text).strip()
        return text.strip()

    for part in payload.get("parts", []):
        part_mime = part.get("mimeType", "")
        if part_mime.startswith("multipart/"):
            nested = _extract_body(part)
            if nested:
                return nested
        if part_mime == "text/plain":
            data = part.get("body", {}).get("data")
            if data:
                return _decode_b64url(data).strip()
        if part_mime == "text/html":
            data = part.get("body", {}).get("data")
            if data:
                return _HTML_CONVERTER.handle(_decode_b64url(data)).strip()
    return ""


def _parse_sender(from_header: str) -> tuple[str, str | None]:
    match = re.match(r"^(?:(.*?)\s)?<?([^<>@\s]+@[^<>@\s]+)>?$", from_header.strip())
    if match:
        name = (match.group(1) or "").strip(" \"'")
        email = match.group(2)
        return name or email.split("@")[0], email
    return from_header, None


def _message_to_content(message: dict) -> NormalizedContent | None:
    payload = message.get("payload", {})
    headers = payload.get("headers", [])
    subject = _header_value(headers, "Subject") or "Newsletter"
    from_header = _header_value(headers, "From") or "Newsletter"
    sender_name, author = _parse_sender(from_header)
    raw_html = _extract_raw_html(payload)
    body = strip_url_noise(_extract_body(payload))
    if not body:
        return None

    internal_date = message.get("internalDate")
    published_at = None
    if internal_date:
        published_at = datetime.fromtimestamp(int(internal_date) / 1000)
    else:
        date_header = _header_value(headers, "Date")
        if date_header:
            try:
                published_at = parsedate_to_datetime(date_header)
            except (TypeError, ValueError, IndexError):
                pass

    msg_id = message.get("id", "")
    gmail_url = f"https://mail.google.com/mail/u/0/#inbox/{msg_id}"

    article_url: str | None = None
    meta: dict = {"gmail_url": gmail_url}
    sender_domain = author.split("@")[-1].lower() if author and "@" in author else ""

    if raw_html:
        if detect_medium_digest(raw_html, author):
            meta["is_medium_digest"] = True
            meta["raw_html"] = raw_html
            medium_urls = extract_article_urls(raw_html)
            if medium_urls:
                article_url = medium_urls[0]
        else:
            outbound = extract_outbound_links(raw_html, sender_domain=sender_domain)
            if outbound:
                article_url = outbound[0]

    if article_url:
        meta["article_url"] = article_url

    public_url = resolve_article_url(article_url, meta) or article_url

    return NormalizedContent(
        title=subject.strip(),
        url=public_url or gmail_url,
        source_name=sender_name,
        source_type="gmail",
        section="Newsletters",
        author=author,
        published_at=published_at,
        clean_text=body,
        summary=body[:400],
        meta=meta,
    )


def _list_message_ids_sync(access_token: str, *, limit: int) -> list[str]:
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {"q": NEWSLETTER_QUERY, "maxResults": str(limit)}
    with httpx.Client(timeout=30.0, headers=headers) as client:
        resp = client.get(f"{GMAIL_API}/messages", params=params)
        resp.raise_for_status()
        data = resp.json()
    return [item["id"] for item in data.get("messages", [])]


def _get_message_sync(access_token: str, message_id: str) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    with httpx.Client(timeout=30.0, headers=headers) as client:
        resp = client.get(
            f"{GMAIL_API}/messages/{message_id}",
            params={"format": "full"},
        )
        resp.raise_for_status()
        return resp.json()


def _count_newsletters_sync(access_token: str) -> int:
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {"q": NEWSLETTER_QUERY, "maxResults": "50"}
    with httpx.Client(timeout=30.0, headers=headers) as client:
        resp = client.get(f"{GMAIL_API}/messages", params=params)
        resp.raise_for_status()
        data = resp.json()
    return data.get("resultSizeEstimate", len(data.get("messages", [])))


def fetch_newsletters_sync(access_token: str, *, limit: int = 8) -> list[NormalizedContent]:
    message_ids = _list_message_ids_sync(access_token, limit=limit)
    articles: list[NormalizedContent] = []
    for message_id in message_ids:
        message = _get_message_sync(access_token, message_id)
        content = _message_to_content(message)
        if content:
            articles.append(content)
    return articles


async def fetch_newsletters(access_token: str, *, limit: int = 8) -> list[NormalizedContent]:
    return await asyncio.to_thread(fetch_newsletters_sync, access_token, limit=limit)


async def count_newsletters(access_token: str) -> int:
    return await asyncio.to_thread(_count_newsletters_sync, access_token)


def fetch_newsletters_from_sender_sync(
    access_token: str,
    sender_email: str,
    *,
    limit: int = 8,
) -> list[NormalizedContent]:
    """Fetch recent newsletter messages from a specific sender in the user's Gmail."""
    sender = sender_email.strip().lower()
    if not sender or "@" not in sender:
        return []

    headers = {"Authorization": f"Bearer {access_token}"}
    query = f"from:{sender} newer_than:14d"
    params = {"q": query, "maxResults": str(min(limit, 3))}

    with httpx.Client(timeout=45.0, headers=headers) as client:
        resp = client.get(f"{GMAIL_API}/messages", params=params)
        resp.raise_for_status()
        message_ids = [m["id"] for m in resp.json().get("messages", [])]

    articles: list[NormalizedContent] = []
    for message_id in message_ids[:limit]:
        try:
            message = _get_message_sync(access_token, message_id)
            content = _message_to_content(message)
            if content:
                content.author = sender
                articles.append(content)
        except Exception:
            continue

    articles.sort(
        key=lambda a: a.published_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return articles


async def fetch_newsletters_from_sender(
    access_token: str,
    sender_email: str,
    *,
    limit: int = 8,
) -> list[NormalizedContent]:
    return await asyncio.to_thread(
        fetch_newsletters_from_sender_sync, access_token, sender_email, limit=limit,
    )
