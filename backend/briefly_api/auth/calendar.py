"""Google Calendar OAuth — readonly access for meeting-aware briefings."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
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

CALENDAR_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
CALENDAR_SCOPES = (
    "https://www.googleapis.com/auth/calendar.readonly openid email"
)
CALENDAR_API = "https://www.googleapis.com/calendar/v3"


def build_calendar_auth_url(settings: Settings, state: str) -> str:
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.calendar_redirect_uri,
        "response_type": "code",
        "scope": settings.calendar_scopes,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{CALENDAR_AUTH_URL}?{urlencode(params)}"


def encode_calendar_state(
    user_id: str, settings: Settings, *, redirect_path: str = "/settings"
) -> str:
    return jwt.encode(
        {
            "user_id": user_id,
            "redirect": redirect_path,
            "flow": "calendar",
            "nonce": generate_oauth_state(),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_calendar_state(state: str, settings: Settings) -> dict:
    payload = jwt.decode(state, settings.secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("flow") != "calendar":
        raise ValueError("Invalid OAuth flow")
    return payload


async def exchange_calendar_code(code: str, settings: Settings) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.calendar_redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_calendar_access_token(
    connection: OAuthConnection, settings: Settings
) -> str:
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


async def get_calendar_connection(
    db: AsyncSession, user_id: str
) -> OAuthConnection | None:
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "google_calendar",
        )
    )
    return result.scalar_one_or_none()


async def upsert_calendar_connection(
    db: AsyncSession,
    user: User,
    tokens: dict,
    account_email: str | None,
    *,
    settings: Settings | None = None,
) -> OAuthConnection:
    s = settings or get_settings()
    connection = await get_calendar_connection(db, user.id)
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
        connection.scopes = (tokens.get("scope") or "").strip() or s.calendar_scopes
    else:
        connection = OAuthConnection(
            user_id=user.id,
            provider="google_calendar",
            account_email=account_email,
            scopes=(tokens.get("scope") or "").strip() or s.calendar_scopes,
            token_expires_at=expires_at,
        )
        set_oauth_tokens(
            connection,
            tokens["access_token"],
            tokens.get("refresh_token"),
        )
        db.add(connection)
    await db.flush()
    return connection
