"""Read/write helpers for encrypted OAuth tokens on OAuthConnection rows."""
from __future__ import annotations

from briefly_api.db.models import OAuthConnection
from briefly_api.security.token_crypto import decrypt_token, encrypt_token


def oauth_access_token(connection: OAuthConnection) -> str:
    return decrypt_token(connection.access_token)


def oauth_refresh_token(connection: OAuthConnection) -> str | None:
    raw = connection.refresh_token
    if not raw:
        return None
    return decrypt_token(raw)


def set_oauth_tokens(
    connection: OAuthConnection,
    access_token: str,
    refresh_token: str | None = None,
) -> None:
    connection.access_token = encrypt_token(access_token)
    if refresh_token is not None:
        connection.refresh_token = encrypt_token(refresh_token) if refresh_token else None
