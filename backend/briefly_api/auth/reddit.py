"""
briefly_api/auth/reddit.py

Reddit OAuth helpers.
Reddit uses its own OAuth server (not Google), so the flow is slightly different —
HTTP Basic Auth for token exchange, state stored as JWT same as Gmail/YouTube.
"""
from __future__ import annotations

import base64
import secrets
from urllib.parse import urlencode

import httpx
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.google import generate_oauth_state
from briefly_api.config import Settings
from briefly_api.db.models import OAuthConnection, Source, User

REDDIT_AUTH_URL = "https://www.reddit.com/api/v1/authorize"
REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
REDDIT_SCOPES = "identity mysubreddits"


def build_reddit_auth_url(settings: Settings, state: str) -> str:
    params = {
        "client_id": settings.reddit_client_id,
        "response_type": "code",
        "state": state,
        "redirect_uri": settings.reddit_redirect_uri,
        "duration": "permanent",
        "scope": REDDIT_SCOPES,
    }
    return f"{REDDIT_AUTH_URL}?{urlencode(params)}"


def encode_reddit_state(user_id: str, settings: Settings, *, redirect_path: str = "/onboarding") -> str:
    return jwt.encode(
        {
            "user_id": user_id,
            "redirect": redirect_path,
            "flow": "reddit",
            "nonce": generate_oauth_state(),
        },
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_reddit_state(state: str, settings: Settings) -> dict:
    payload = jwt.decode(state, settings.secret_key, algorithms=[settings.jwt_algorithm])
    if payload.get("flow") != "reddit":
        raise ValueError("Invalid OAuth flow")
    return payload


def _basic_auth_header(client_id: str, client_secret: str) -> str:
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    return f"Basic {credentials}"


async def exchange_reddit_code(code: str, settings: Settings) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            REDDIT_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.reddit_redirect_uri,
            },
            headers={
                "Authorization": _basic_auth_header(settings.reddit_client_id, settings.reddit_client_secret),
                "User-Agent": settings.reddit_user_agent,
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def refresh_reddit_access_token(connection: OAuthConnection, settings: Settings) -> str:
    """Reddit tokens expire after 1 hour. Use refresh_token to renew."""
    if not connection.refresh_token:
        return connection.access_token

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            REDDIT_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": connection.refresh_token,
            },
            headers={
                "Authorization": _basic_auth_header(settings.reddit_client_id, settings.reddit_client_secret),
                "User-Agent": settings.reddit_user_agent,
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        resp.raise_for_status()
        tokens = resp.json()

    connection.access_token = tokens["access_token"]
    return connection.access_token


async def get_reddit_username(access_token: str, settings: Settings) -> str | None:
    """Fetch the Reddit username for the authenticated user."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://oauth.reddit.com/api/v1/me",
            headers={
                "Authorization": f"Bearer {access_token}",
                "User-Agent": settings.reddit_user_agent,
            },
        )
        if resp.status_code == 200:
            return resp.json().get("name")
    return None


async def get_reddit_connection(db: AsyncSession, user_id: str) -> OAuthConnection | None:
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "reddit",
        )
    )
    return result.scalar_one_or_none()


async def upsert_reddit_connection(
    db: AsyncSession,
    user: User,
    tokens: dict,
    username: str | None,
    subreddit_count: int = 0,
) -> OAuthConnection:
    connection = await get_reddit_connection(db, user.id)

    if connection:
        connection.access_token = tokens["access_token"]
        if tokens.get("refresh_token"):
            connection.refresh_token = tokens["refresh_token"]
        if username:
            connection.account_email = username
        connection.meta = {**(connection.meta or {}), "subreddit_count": subreddit_count}
    else:
        connection = OAuthConnection(
            user_id=user.id,
            provider="reddit",
            account_email=username,
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
            scopes=REDDIT_SCOPES,
            meta={"subreddit_count": subreddit_count},
        )
        db.add(connection)

    await ensure_reddit_source(db, user, username or "reddit_user", subreddit_count)
    await db.flush()
    return connection


async def ensure_reddit_source(
    db: AsyncSession,
    user: User,
    identifier: str,
    subreddit_count: int = 0,
) -> Source:
    from briefly_api.services.connectors.types import REDDIT_ACCOUNT

    result = await db.execute(
        select(Source).where(
            Source.user_id == user.id,
            Source.source_type == REDDIT_ACCOUNT,
        )
    )
    source = result.scalar_one_or_none()
    if source:
        source.meta = {**(source.meta or {}), "subreddit_count": subreddit_count}
        return source

    source = Source(
        user_id=user.id,
        source_type=REDDIT_ACCOUNT,
        identifier=identifier.lower(),
        name=f"Reddit subscriptions ({subreddit_count} subreddits)",
        meta={"subreddit_count": subreddit_count},
    )
    db.add(source)
    await db.flush()
    return source
