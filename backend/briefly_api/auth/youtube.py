"""
briefly_api/auth/youtube.py

YouTube OAuth helpers — identical pattern to auth/gmail.py.
Uses the same Google OAuth server but requests youtube.readonly scope,
which lets Briefly read the user's channel subscriptions.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.google import (
    GOOGLE_TOKEN_URL,
    generate_oauth_state,
    raise_if_google_refresh_rejected,
)
from briefly_api.config import Settings
from briefly_api.db.models import OAuthConnection, Source, User
from briefly_api.security.oauth_tokens import (
    oauth_access_token,
    oauth_refresh_token,
    set_oauth_tokens,
)

YOUTUBE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
YOUTUBE_SCOPES = "https://www.googleapis.com/auth/youtube.readonly openid email"


def build_youtube_auth_url(settings: Settings, state: str) -> str:
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.youtube_redirect_uri,
        "response_type": "code",
        "scope": YOUTUBE_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{YOUTUBE_AUTH_URL}?{urlencode(params)}"


def encode_youtube_state(user_id: str, settings: Settings, *, redirect_path: str = "/onboarding") -> str:
    return jwt.encode(
        {
            "user_id": user_id,
            "redirect": redirect_path,
            "flow": "youtube",
            "nonce": generate_oauth_state(),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_youtube_state(state: str, settings: Settings) -> dict:
    payload = jwt.decode(state, settings.secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("flow") != "youtube":
        raise ValueError("Invalid OAuth flow")
    return payload


async def exchange_youtube_code(code: str, settings: Settings) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.youtube_redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_youtube_access_token(connection: OAuthConnection, settings: Settings) -> str:
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
        raise_if_google_refresh_rejected(resp, "YouTube")
        resp.raise_for_status()
        tokens = resp.json()

    set_oauth_tokens(connection, tokens["access_token"])
    expires_in = tokens.get("expires_in")
    if expires_in:
        connection.token_expires_at = now + timedelta(seconds=int(expires_in))
    return oauth_access_token(connection)


async def get_youtube_connection(db: AsyncSession, user_id: str) -> OAuthConnection | None:
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "youtube",
        )
    )
    return result.scalar_one_or_none()


async def upsert_youtube_connection(
    db: AsyncSession,
    user: User,
    tokens: dict,
    account_email: str | None,
    channel_count: int = 0,
) -> OAuthConnection:
    connection = await get_youtube_connection(db, user.id)
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
        connection.meta = {**(connection.meta or {}), "channel_count": channel_count}
    else:
        connection = OAuthConnection(
            user_id=user.id,
            provider="youtube",
            account_email=account_email,
            access_token="",
            refresh_token=None,
            token_expires_at=expires_at,
            scopes=YOUTUBE_SCOPES,
            meta={"channel_count": channel_count},
        )
        set_oauth_tokens(
            connection,
            tokens["access_token"],
            tokens.get("refresh_token"),
        )
        db.add(connection)

    await ensure_youtube_source(db, user, account_email or user.email, channel_count)
    await db.flush()
    return connection


async def ensure_youtube_source(
    db: AsyncSession,
    user: User,
    identifier: str,
    channel_count: int = 0,
) -> Source:
    from briefly_api.services.connectors.types import YOUTUBE_ACCOUNT

    result = await db.execute(
        select(Source).where(
            Source.user_id == user.id,
            Source.source_type == YOUTUBE_ACCOUNT,
        )
    )
    source = result.scalar_one_or_none()
    if source:
        source.meta = {**(source.meta or {}), "channel_count": channel_count}
        return source

    source = Source(
        user_id=user.id,
        source_type=YOUTUBE_ACCOUNT,
        identifier=identifier.lower(),
        name=f"YouTube subscriptions ({channel_count} channels)",
        meta={"channel_count": channel_count},
    )
    db.add(source)
    await db.flush()
    return source
