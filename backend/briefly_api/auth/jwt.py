from __future__ import annotations

from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from briefly_api.config import Settings


def create_access_token(user_id: str, settings: Settings) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str, settings: Settings) -> str | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        return user_id if isinstance(user_id, str) else None
    except JWTError:
        return None
