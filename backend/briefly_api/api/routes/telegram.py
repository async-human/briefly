"""
Telegram channel endpoints.

  POST /telegram/webhook      Telegram → us (public; verified by secret token)
  POST /telegram/link-code    mint a /start deep link to connect a chat   (auth)
  GET  /telegram/status       connection state + prefs                     (auth)
  POST /telegram/disconnect   unlink this user's chat                      (auth)
  POST /telegram/preferences  toggle voice replies / proactive alerts      (auth)
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import TelegramAccount, User
from briefly_api.services.telegram_bot import handle_update

log = logging.getLogger(__name__)

router = APIRouter(prefix="/telegram", tags=["telegram"])

_LINK_CODE_TTL = timedelta(minutes=15)


class TelegramStatus(BaseModel):
    connected: bool
    username: str | None = None
    voice_replies: bool = True
    proactive_enabled: bool = True


class TelegramLinkOut(BaseModel):
    deep_link: str
    bot_username: str


class TelegramPrefsIn(BaseModel):
    voice_replies: bool | None = None
    proactive_enabled: bool | None = None


@router.post("/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
):
    """Receive Telegram updates. Verified by the secret token set at registration."""
    expected = settings.telegram_webhook_secret
    if expected and x_telegram_bot_api_secret_token != expected:
        # Don't leak which check failed; just refuse.
        return {"ok": False}
    try:
        update = await request.json()
    except Exception:
        return {"ok": False}
    await handle_update(update)
    return {"ok": True}


async def _account_for_user(db: AsyncSession, user_id: str) -> TelegramAccount | None:
    return (
        await db.execute(
            select(TelegramAccount).where(TelegramAccount.user_id == user_id)
        )
    ).scalar_one_or_none()


@router.get("/status", response_model=TelegramStatus)
async def telegram_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TelegramStatus:
    account = await _account_for_user(db, user.id)
    if account is None or account.chat_id is None:
        return TelegramStatus(connected=False)
    return TelegramStatus(
        connected=True,
        username=account.username,
        voice_replies=account.voice_replies,
        proactive_enabled=account.proactive_enabled,
    )


@router.post("/link-code", response_model=TelegramLinkOut)
async def telegram_link_code(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> TelegramLinkOut:
    code = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + _LINK_CODE_TTL

    account = await _account_for_user(db, user.id)
    if account is None:
        account = TelegramAccount(user_id=user.id)
        db.add(account)
    account.link_code = code
    account.link_code_expires_at = expires
    await db.commit()

    bot = settings.telegram_bot_username.lstrip("@")
    return TelegramLinkOut(
        deep_link=f"https://t.me/{bot}?start={code}",
        bot_username=bot,
    )


@router.post("/disconnect", status_code=status.HTTP_204_NO_CONTENT)
async def telegram_disconnect(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    account = await _account_for_user(db, user.id)
    if account is not None:
        account.chat_id = None
        account.linked_at = None
        account.link_code = None
        account.link_code_expires_at = None
        await db.commit()


@router.post("/preferences", response_model=TelegramStatus)
async def telegram_preferences(
    body: TelegramPrefsIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TelegramStatus:
    account = await _account_for_user(db, user.id)
    if account is None or account.chat_id is None:
        return TelegramStatus(connected=False)
    if body.voice_replies is not None:
        account.voice_replies = body.voice_replies
    if body.proactive_enabled is not None:
        account.proactive_enabled = body.proactive_enabled
    await db.commit()
    return TelegramStatus(
        connected=True,
        username=account.username,
        voice_replies=account.voice_replies,
        proactive_enabled=account.proactive_enabled,
    )
