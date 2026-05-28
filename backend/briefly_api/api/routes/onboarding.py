from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.api.schemas import GmailConnectOut, GmailStatusOut, OnboardingCompleteOut, OnboardingStatusOut, ProfileUpdate
from briefly_api.auth.deps import get_current_user
from briefly_api.auth.gmail import (
    build_gmail_auth_url,
    decode_gmail_state,
    encode_gmail_state,
    exchange_gmail_code,
    get_gmail_connection,
    refresh_gmail_access_token,
    upsert_gmail_connection,
)
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import Source, User
from briefly_api.services.gmail import count_newsletters

router = APIRouter(tags=["onboarding"])


@router.get("/onboarding/status", response_model=OnboardingStatusOut)
async def get_onboarding_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatusOut:
    gmail = await get_gmail_connection(db, user.id)
    sources_count = await db.scalar(
        select(func.count()).select_from(Source).where(Source.user_id == user.id)
    )
    profile = user.profile
    return OnboardingStatusOut(
        onboarding_completed=bool(profile and profile.onboarding_completed),
        profile_started=bool(profile and profile.role),
        gmail_connected=gmail is not None,
        gmail_email=gmail.account_email if gmail else None,
        newsletter_count=(gmail.meta or {}).get("newsletter_count") if gmail else None,
        sources_count=sources_count or 0,
    )


@router.patch("/onboarding/profile")
async def update_onboarding_profile(
    body: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatusOut:
    if not user.profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    profile = user.profile
    if body.role is not None:
        profile.role = body.role.strip() or None
    if body.goal is not None:
        profile.goal = body.goal.strip() or None
    if body.digest_time is not None:
        profile.digest_time = body.digest_time
    if body.digest_timezone is not None:
        profile.digest_timezone = body.digest_timezone
    await db.commit()
    return await get_onboarding_status(user, db)


@router.post("/onboarding/complete", response_model=OnboardingCompleteOut)
async def complete_onboarding(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OnboardingCompleteOut:
    if not user.profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found.")
    user.profile.onboarding_completed = True
    await db.commit()
    return OnboardingCompleteOut(onboarding_completed=True)


@router.post("/auth/gmail/start", response_model=GmailConnectOut)
async def start_gmail_connect(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    redirect_path: str = Query("/onboarding"),
) -> GmailConnectOut:
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured.",
        )
    state = encode_gmail_state(user.id, settings, redirect_path=redirect_path)
    return GmailConnectOut(url=build_gmail_auth_url(settings, state))


@router.get("/auth/gmail/callback")
async def gmail_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    try:
        payload = decode_gmail_state(state, settings)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state") from exc

    user_id = payload["user_id"]
    redirect_path = payload.get("redirect", "/onboarding")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    tokens = await exchange_gmail_code(code, settings)
    connection = await upsert_gmail_connection(db, user, tokens, user.email)

    try:
        access_token = await refresh_gmail_access_token(connection, settings)
        newsletter_count = await count_newsletters(access_token)
        connection.meta = {**(connection.meta or {}), "newsletter_count": newsletter_count}
    except Exception:
        connection.meta = {**(connection.meta or {}), "newsletter_count": None}

    await db.commit()

    base = settings.frontend_url.rstrip("/")
    return RedirectResponse(f"{base}{redirect_path}?gmail=connected")


@router.get("/auth/gmail/status", response_model=GmailStatusOut)
async def gmail_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GmailStatusOut:
    connection = await get_gmail_connection(db, user.id)
    if not connection:
        return GmailStatusOut(connected=False)
    return GmailStatusOut(
        connected=True,
        email=connection.account_email,
        newsletter_count=(connection.meta or {}).get("newsletter_count"),
    )


@router.delete("/auth/gmail", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def disconnect_gmail(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    connection = await get_gmail_connection(db, user.id)
    if connection:
        await db.delete(connection)
    gmail_sources = await db.execute(
        select(Source).where(Source.user_id == user.id, Source.source_type == "gmail")
    )
    for source in gmail_sources.scalars().all():
        await db.delete(source)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
