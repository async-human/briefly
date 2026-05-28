from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.google import GOOGLE_TOKEN_URL, generate_oauth_state
from briefly_api.config import Settings
from briefly_api.db.models import OAuthConnection, Source, User

GMAIL_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly openid email"


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
    if not connection.refresh_token:
        return connection.access_token

    now = datetime.now(UTC)
    if connection.token_expires_at and connection.token_expires_at > now + timedelta(minutes=2):
        return connection.access_token

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "refresh_token": connection.refresh_token,
                "grant_type": "refresh_token",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        tokens = resp.json()

    connection.access_token = tokens["access_token"]
    expires_in = tokens.get("expires_in")
    if expires_in:
        connection.token_expires_at = now + timedelta(seconds=int(expires_in))
    return connection.access_token


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
) -> OAuthConnection:
    connection = await get_gmail_connection(db, user.id)
    expires_at = None
    if tokens.get("expires_in"):
        expires_at = datetime.now(UTC) + timedelta(seconds=int(tokens["expires_in"]))

    if connection:
        connection.access_token = tokens["access_token"]
        if tokens.get("refresh_token"):
            connection.refresh_token = tokens["refresh_token"]
        connection.token_expires_at = expires_at
        if account_email:
            connection.account_email = account_email
    else:
        connection = OAuthConnection(
            user_id=user.id,
            provider="gmail",
            account_email=account_email,
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
            token_expires_at=expires_at,
            scopes=GMAIL_SCOPES,
        )
        db.add(connection)

    await ensure_gmail_source(db, user, account_email or user.email)
    await db.flush()
    return connection


async def ensure_gmail_source(db: AsyncSession, user: User, account_email: str) -> Source:
    identifier = account_email.lower()
    result = await db.execute(
        select(Source).where(
            Source.user_id == user.id,
            Source.source_type == "gmail",
            Source.identifier == identifier,
        )
    )
    source = result.scalar_one_or_none()
    if source:
        return source

    source = Source(
        user_id=user.id,
        source_type="gmail",
        identifier=identifier,
        name="Gmail newsletters",
    )
    db.add(source)
    await db.flush()
    return source
