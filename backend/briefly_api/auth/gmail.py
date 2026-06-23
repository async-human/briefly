from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from email.utils import getaddresses
from urllib.parse import urlencode

import httpx
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.google import GOOGLE_TOKEN_URL, generate_oauth_state
from briefly_api.config import Settings, get_settings
from briefly_api.db.models import OAuthConnection, User
from briefly_api.security.oauth_tokens import (
    oauth_access_token,
    oauth_refresh_token,
    set_oauth_tokens,
)

GMAIL_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly openid email"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

GMAIL_ERROR_HINTS: dict[str, str] = {
    "insufficient_scope": (
        "Gmail is connected but inbox read access wasn't granted. "
        "Reconnect and approve all requested permissions."
    ),
    "api_disabled": (
        "The Gmail API isn't enabled for this app yet. "
        "Enable it in Google Cloud Console or contact support."
    ),
    "forbidden": (
        "Google blocked inbox access. If the app is in testing mode, "
        "your Google account must be added as a test user in Cloud Console."
    ),
}


class GmailAccessError(Exception):
    def __init__(self, message: str, *, reason: str = "forbidden"):
        self.reason = reason
        super().__init__(message)


def classify_gmail_http_error(response: httpx.Response) -> GmailAccessError:
    try:
        body = response.json()
        msg = body.get("error", {}).get("message") or response.text
    except Exception:
        msg = response.text or f"HTTP {response.status_code}"
    reason = "forbidden"
    low = msg.lower()
    if "insufficient" in low and "scope" in low:
        reason = "insufficient_scope"
    elif any(
        phrase in low
        for phrase in ("has not been used", "is disabled", "access not configured", "not enabled")
    ):
        reason = "api_disabled"
    return GmailAccessError(msg, reason=reason)


def user_message_for_gmail_error(reason: str, detail: str | None = None) -> str:
    hint = GMAIL_ERROR_HINTS.get(reason, GMAIL_ERROR_HINTS["forbidden"])
    if detail and reason == "forbidden":
        return f"{hint} ({detail[:160]})"
    return hint


def probe_gmail_messages_access(access_token: str) -> None:
    """Raise GmailAccessError if messages.list is not permitted."""
    with httpx.Client(timeout=20.0) as client:
        resp = client.get(
            f"{GMAIL_API}/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"maxResults": "1"},
        )
    if resp.status_code == 200:
        return
    if resp.status_code in {401, 403}:
        raise classify_gmail_http_error(resp)
    resp.raise_for_status()


def build_gmail_auth_url(settings: Settings, state: str) -> str:
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.gmail_redirect_uri,
        "response_type": "code",
        "scope": settings.gmail_scopes,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{GMAIL_AUTH_URL}?{urlencode(params)}"


def encode_gmail_state(user_id: str, settings: Settings, *, redirect_path: str = "/onboarding") -> str:
    return jwt.encode(
        {
            "user_id": user_id,
            "redirect": redirect_path,
            "flow": "gmail",
            "nonce": generate_oauth_state(),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_gmail_state(state: str, settings: Settings) -> dict:
    payload = jwt.decode(state, settings.secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("flow") != "gmail":
        raise ValueError("Invalid OAuth flow")
    return payload


async def exchange_gmail_code(code: str, settings: Settings) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.gmail_redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_gmail_access_token(connection: OAuthConnection, settings: Settings) -> str:
    refresh = oauth_refresh_token(connection)
    if not refresh:
        return oauth_access_token(connection)

    now = datetime.now(UTC)
    if connection.token_expires_at and connection.token_expires_at > now + timedelta(minutes=2):
        return oauth_access_token(connection)

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": refresh,
                "grant_type": "refresh_token",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        tokens = resp.json()

    set_oauth_tokens(connection, tokens["access_token"])
    expires_in = tokens.get("expires_in")
    if expires_in:
        connection.token_expires_at = now + timedelta(seconds=int(expires_in))
    return oauth_access_token(connection)


def gmail_connection_can_send(connection: OAuthConnection | None) -> bool:
    """True if the grant can send mail. gmail.compose is a superset that also
    permits sending, so either scope qualifies."""
    scopes = (connection.scopes or "") if connection else ""
    return bool(connection and ("gmail.send" in scopes or "gmail.compose" in scopes))


def gmail_connection_can_create_draft(connection: OAuthConnection | None) -> bool:
    """True if the grant can create drafts in the user's Gmail (gmail.compose)."""
    return bool(connection and "gmail.compose" in (connection.scopes or ""))


async def create_gmail_draft(
    connection: OAuthConnection,
    settings: Settings,
    *,
    to: str | None,
    subject: str,
    body: str,
    from_email: str | None = None,
) -> str:
    """Create a draft in the user's Gmail (drafts.create). The user opens Gmail
    and hits Send — Briefly never sends. Requires the gmail.compose scope.
    Returns the Gmail draft id. Raises GmailAccessError if the scope is missing."""
    token = await refresh_gmail_access_token(connection, settings)
    msg = EmailMessage()
    if to:
        msg["To"] = to
    if from_email:
        msg["From"] = from_email
    msg["Subject"] = subject
    msg.set_content(body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{GMAIL_API}/drafts",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"message": {"raw": raw}},
        )
    if resp.status_code in {401, 403}:
        raise classify_gmail_http_error(resp)
    resp.raise_for_status()
    return (resp.json() or {}).get("id", "")


async def search_contact_email(access_token: str, name: str) -> tuple[str, str] | None:
    """Resolve a person's name to an email address from the user's Gmail history
    (no extra scope beyond gmail.readonly). Returns (email, display_name) for the
    first message participant whose name/address matches all tokens of `name`, or
    None. The voice flow reads the address back for confirmation, so a wrong match
    is caught before anything sends."""
    name = (name or "").strip()
    if not name:
        return None
    tokens = [t for t in name.lower().split() if t]

    async with httpx.AsyncClient(timeout=20.0) as client:
        listing = await client.get(
            f"{GMAIL_API}/messages",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"q": name, "maxResults": 10},
        )
        if listing.status_code in {401, 403}:
            raise classify_gmail_http_error(listing)
        if listing.status_code != 200:
            return None
        message_ids = [m["id"] for m in (listing.json().get("messages") or [])]

        for mid in message_ids:
            meta = await client.get(
                f"{GMAIL_API}/messages/{mid}",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"format": "metadata", "metadataHeaders": ["From", "To", "Cc"]},
            )
            if meta.status_code != 200:
                continue
            headers = (meta.json().get("payload") or {}).get("headers") or []
            for header in headers:
                if header.get("name") not in ("From", "To", "Cc"):
                    continue
                for display, addr in getaddresses([header.get("value", "")]):
                    if not addr or "@" not in addr:
                        continue
                    haystack = f"{display} {addr}".lower()
                    if all(tok in haystack for tok in tokens):
                        return addr, (display.strip() or addr)
    return None


async def send_gmail_message(
    connection: OAuthConnection,
    settings: Settings,
    *,
    to: str,
    subject: str,
    body: str,
    from_email: str | None = None,
) -> None:
    """Send a plain-text email via the Gmail API (messages.send). Raises
    GmailAccessError if the send scope wasn't granted (caller prompts reconnect)."""
    token = await refresh_gmail_access_token(connection, settings)
    msg = EmailMessage()
    msg["To"] = to
    if from_email:
        msg["From"] = from_email
    msg["Subject"] = subject
    msg.set_content(body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{GMAIL_API}/messages/send",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"raw": raw},
        )
    if resp.status_code in {401, 403}:
        raise classify_gmail_http_error(resp)
    resp.raise_for_status()


async def get_gmail_connection(db: AsyncSession, user_id: str) -> OAuthConnection | None:
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "gmail",
        )
    )
    return result.scalar_one_or_none()


async def upsert_gmail_connection(
    db: AsyncSession,
    user: User,
    tokens: dict,
    account_email: str | None,
    *,
    settings: Settings | None = None,
) -> OAuthConnection:
    s = settings or get_settings()
    connection = await get_gmail_connection(db, user.id)
    expires_at = None
    if tokens.get("expires_in"):
        expires_at = datetime.now(UTC) + timedelta(seconds=int(tokens["expires_in"]))

    if connection:
        set_oauth_tokens(
            connection,
            tokens["access_token"],
            tokens.get("refresh_token"),
        )
        connection.token_expires_at = expires_at
        if account_email:
            connection.account_email = account_email
        granted = (tokens.get("scope") or "").strip()
        connection.scopes = granted or s.gmail_scopes
        meta = dict(connection.meta or {})
        meta.pop("access_error", None)
        meta.pop("access_error_message", None)
        connection.meta = meta
    else:
        connection = OAuthConnection(
            user_id=user.id,
            provider="gmail",
            account_email=account_email,
            access_token="",
            refresh_token=None,
            token_expires_at=expires_at,
            scopes=(tokens.get("scope") or "").strip() or s.gmail_scopes,
        )
        set_oauth_tokens(
            connection,
            tokens["access_token"],
            tokens.get("refresh_token"),
        )
        db.add(connection)

    await db.flush()
    return connection
