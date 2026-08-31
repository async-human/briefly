from __future__ import annotations

import logging
import secrets
from urllib.parse import urlencode

import httpx

from briefly_api.config import Settings

log = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


class GoogleTokenRevoked(Exception):
    """Refresh token is expired, revoked, or otherwise unusable."""


def raise_if_google_refresh_rejected(resp: httpx.Response, service: str) -> None:
    """Raise GoogleTokenRevoked on invalid_grant / revoked refresh tokens."""
    if resp.status_code not in (400, 401):
        return
    log.warning(
        "Google %s refresh rejected (%s) — reconnect in Settings. body=%s",
        service,
        resp.status_code,
        resp.text[:300],
    )
    raise GoogleTokenRevoked(f"Google {service} refresh token is no longer valid")


def build_google_auth_url(settings: Settings, state: str) -> str:
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def generate_oauth_state() -> str:
    return secrets.token_urlsafe(32)


async def exchange_google_code(code: str, settings: Settings) -> dict:
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

        user_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        user_resp.raise_for_status()
        return user_resp.json()
