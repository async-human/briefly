from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.google import build_google_auth_url, exchange_google_code, generate_oauth_state
from briefly_api.auth.jwt import create_access_token
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.services.users import get_or_create_google_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/oauth-config")
async def oauth_config(settings: Settings = Depends(get_settings)) -> dict:
    """Return redirect URIs to register in Google Cloud Console (helps fix redirect_uri_mismatch)."""
    return {
        "backend_url": settings.backend_url.rstrip("/"),
        "google_sign_in_redirect_uri": settings.google_redirect_uri,
        "gmail_connect_redirect_uri": settings.gmail_redirect_uri,
        "youtube_connect_redirect_uri": settings.youtube_redirect_uri,
        "calendar_connect_redirect_uri": settings.calendar_redirect_uri,
        "youtube_uses_gmail_callback": True,
        "calendar_uses_gmail_callback": True,
    }


def _encode_state(settings: Settings) -> str:
    return jwt.encode({"nonce": generate_oauth_state()}, settings.secret_key, algorithm=settings.jwt_algorithm)


def _decode_state(state: str, settings: Settings) -> bool:
    try:
        jwt.decode(state, settings.secret_key, algorithms=[settings.jwt_algorithm])
        return True
    except JWTError:
        return False


@router.get("/google")
async def google_login(settings: Settings = Depends(get_settings)) -> RedirectResponse:
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured",
        )
    state = _encode_state(settings)
    return RedirectResponse(build_google_auth_url(settings, state))


@router.get("/google/callback")
async def google_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    if not _decode_state(state, settings):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state")

    google_user = await exchange_google_code(code, settings)
    user = await get_or_create_google_user(db, google_user)
    token = create_access_token(user.id, settings)

    redirect_url = f"{settings.frontend_url.rstrip('/')}/auth/callback?token={token}"
    return RedirectResponse(redirect_url)
