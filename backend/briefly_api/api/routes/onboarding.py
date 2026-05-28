from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.api.schemas import (
    GmailConnectOut,
    GmailStatusOut,
    OnboardingCompleteOut,
    OnboardingStatusOut,
    ProfileUpdate,
    RedditConnectOut,
    RedditStatusOut,
    YouTubeConnectOut,
    YouTubeStatusOut,
)
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
from briefly_api.auth.youtube import (
    build_youtube_auth_url,
    decode_youtube_state,
    encode_youtube_state,
    exchange_youtube_code,
    get_youtube_connection,
    refresh_youtube_access_token,
    upsert_youtube_connection,
)
from briefly_api.auth.reddit import (
    build_reddit_auth_url,
    decode_reddit_state,
    encode_reddit_state,
    exchange_reddit_code,
    get_reddit_connection,
    get_reddit_username,
    refresh_reddit_access_token,
    upsert_reddit_connection,
)
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import Source, User
from briefly_api.services.gmail import count_newsletters
from briefly_api.services.youtube import count_subscriptions
from briefly_api.services.reddit import count_subscribed_subreddits

router = APIRouter(tags=["onboarding"])


# ── Status helpers ────────────────────────────────────────────────────────────

async def _build_onboarding_status(
    user: User,
    db: AsyncSession,
) -> OnboardingStatusOut:
    gmail = await get_gmail_connection(db, user.id)
    youtube = await get_youtube_connection(db, user.id)
    reddit = await get_reddit_connection(db, user.id)
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
        youtube_connected=youtube is not None,
        youtube_channel_count=(youtube.meta or {}).get("channel_count") if youtube else None,
        reddit_connected=reddit is not None,
        reddit_subreddit_count=(reddit.meta or {}).get("subreddit_count") if reddit else None,
        sources_count=sources_count or 0,
    )


# ── Onboarding core ───────────────────────────────────────────────────────────

@router.get("/onboarding/status", response_model=OnboardingStatusOut)
async def get_onboarding_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatusOut:
    return await _build_onboarding_status(user, db)


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
    return await _build_onboarding_status(user, db)


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


# ── Gmail OAuth ───────────────────────────────────────────────────────────────

@router.post("/auth/gmail/start", response_model=GmailConnectOut)
async def start_gmail_connect(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    redirect_path: str = Query("/onboarding"),
) -> GmailConnectOut:
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google OAuth is not configured.")
    state = encode_gmail_state(user.id, settings, redirect_path=redirect_path)
    return GmailConnectOut(url=build_gmail_auth_url(settings, state))


@router.get("/auth/gmail/callback")
async def gmail_callback(
    settings: Settings = Depends(get_settings),
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    base = settings.frontend_url.rstrip("/")
    if error:
        return RedirectResponse(f"{base}/onboarding?gmail=denied")
    if not code or not state:
        return RedirectResponse(f"{base}/onboarding?gmail=error")
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
        pass
    await db.commit()
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


# ── YouTube OAuth ─────────────────────────────────────────────────────────────

@router.post("/auth/youtube/start", response_model=YouTubeConnectOut)
async def start_youtube_connect(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    redirect_path: str = Query("/onboarding"),
) -> YouTubeConnectOut:
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google OAuth is not configured.")
    state = encode_youtube_state(user.id, settings, redirect_path=redirect_path)
    return YouTubeConnectOut(url=build_youtube_auth_url(settings, state))


@router.get("/auth/youtube/callback")
async def youtube_callback(
    settings: Settings = Depends(get_settings),
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    base = settings.frontend_url.rstrip("/")
    if error:
        return RedirectResponse(f"{base}/onboarding?youtube=denied")
    if not code or not state:
        return RedirectResponse(f"{base}/onboarding?youtube=error")
    try:
        payload = decode_youtube_state(state, settings)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state") from exc

    user_id = payload["user_id"]
    redirect_path = payload.get("redirect", "/onboarding")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    tokens = await exchange_youtube_code(code, settings)
    # Count subscriptions immediately so we can show "50 channels found"
    channel_count = 0
    try:
        channel_count = await count_subscriptions(tokens["access_token"], settings.reddit_user_agent)
    except Exception:
        pass

    await upsert_youtube_connection(db, user, tokens, user.email, channel_count)
    await db.commit()
    return RedirectResponse(f"{base}{redirect_path}?youtube=connected&channels={channel_count}")


@router.get("/auth/youtube/status", response_model=YouTubeStatusOut)
async def youtube_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> YouTubeStatusOut:
    connection = await get_youtube_connection(db, user.id)
    if not connection:
        return YouTubeStatusOut(connected=False)
    return YouTubeStatusOut(
        connected=True,
        email=connection.account_email,
        channel_count=(connection.meta or {}).get("channel_count"),
    )


@router.delete("/auth/youtube", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def disconnect_youtube(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    from briefly_api.services.connectors.types import YOUTUBE_ACCOUNT
    connection = await get_youtube_connection(db, user.id)
    if connection:
        await db.delete(connection)
    sources = await db.execute(
        select(Source).where(Source.user_id == user.id, Source.source_type == YOUTUBE_ACCOUNT)
    )
    for source in sources.scalars().all():
        await db.delete(source)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Reddit OAuth ──────────────────────────────────────────────────────────────

@router.post("/auth/reddit/start", response_model=RedditConnectOut)
async def start_reddit_connect(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    redirect_path: str = Query("/onboarding"),
) -> RedditConnectOut:
    if not settings.reddit_client_id or not settings.reddit_client_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Reddit OAuth is not configured.")
    state = encode_reddit_state(user.id, settings, redirect_path=redirect_path)
    return RedditConnectOut(url=build_reddit_auth_url(settings, state))


@router.get("/auth/reddit/callback")
async def reddit_callback(
    settings: Settings = Depends(get_settings),
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    base = settings.frontend_url.rstrip("/")
    if error:
        return RedirectResponse(f"{base}/onboarding?reddit=denied")
    if not code or not state:
        return RedirectResponse(f"{base}/onboarding?reddit=error")
    try:
        payload = decode_reddit_state(state, settings)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state") from exc

    user_id = payload["user_id"]
    redirect_path = payload.get("redirect", "/onboarding")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    tokens = await exchange_reddit_code(code, settings)
    username = await get_reddit_username(tokens["access_token"], settings)
    subreddit_count = 0
    try:
        subreddit_count = await count_subscribed_subreddits(tokens["access_token"], settings.reddit_user_agent)
    except Exception:
        pass

    await upsert_reddit_connection(db, user, tokens, username, subreddit_count)
    await db.commit()
    return RedirectResponse(f"{base}{redirect_path}?reddit=connected&subreddits={subreddit_count}")


@router.get("/auth/reddit/status", response_model=RedditStatusOut)
async def reddit_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RedditStatusOut:
    connection = await get_reddit_connection(db, user.id)
    if not connection:
        return RedditStatusOut(connected=False)
    return RedditStatusOut(
        connected=True,
        username=connection.account_email,
        subreddit_count=(connection.meta or {}).get("subreddit_count"),
    )


@router.delete("/auth/reddit", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def disconnect_reddit(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    from briefly_api.services.connectors.types import REDDIT_ACCOUNT
    connection = await get_reddit_connection(db, user.id)
    if connection:
        await db.delete(connection)
    sources = await db.execute(
        select(Source).where(Source.user_id == user.id, Source.source_type == REDDIT_ACCOUNT)
    )
    for source in sources.scalars().all():
        await db.delete(source)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
