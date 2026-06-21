"""
briefly_api/services/telegram.py

Telegram Bot API client + outbound delivery — the channel adapter that lets
Briefly reach users where they already are. Outbound mirrors web_push:
`send_telegram_to_user(user_id, payload)` is the one function the proactive
notifier calls, alongside `send_push_to_user`.

Raw Bot API over httpx (no python-telegram-bot dependency). Inbound update
handling lives in `telegram_bot.py`; this module is transport + outbound only.
"""
from __future__ import annotations

import logging

import httpx
from sqlalchemy import select

from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import Digest, DigestItem, TelegramAccount, User
from briefly_api.stt.audio_utils import convert_to_ogg_opus
from briefly_api.tts.adapter import get_tts_adapter
from briefly_api.utils.dates import local_date_string

log = logging.getLogger(__name__)

_API_ROOT = "https://api.telegram.org"


def telegram_ready() -> bool:
    s = get_settings()
    return bool(s.telegram_enabled and s.telegram_bot_token)


def _api_base() -> str:
    return f"{_API_ROOT}/bot{get_settings().telegram_bot_token}"


# ── Low-level Bot API ─────────────────────────────────────────────────────────


async def _api(method: str, payload: dict | None = None, *, files: dict | None = None) -> dict:
    """Call a Bot API method. Returns the parsed `result` (or {} on failure)."""
    if not telegram_ready():
        log.info("telegram: not configured — skipping %s", method)
        return {}
    url = f"{_api_base()}/{method}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if files:
                resp = await client.post(url, data=payload or {}, files=files)
            else:
                resp = await client.post(url, json=payload or {})
        body = resp.json()
        if not body.get("ok"):
            log.warning("telegram %s failed: %s", method, str(body)[:300])
            return {}
        return body.get("result") or {}
    except Exception:
        log.exception("telegram %s request error", method)
        return {}


async def send_message(
    chat_id: int,
    text: str,
    *,
    url_button: tuple[str, str] | None = None,
    disable_preview: bool = True,
) -> bool:
    """Send a plain-text message, optionally with one inline URL button (label, url)."""
    payload: dict = {
        "chat_id": chat_id,
        "text": text[:4096],
        "disable_web_page_preview": disable_preview,
    }
    if url_button:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": url_button[0], "url": url_button[1]}]]
        }
    return bool(await _api("sendMessage", payload))


async def send_chat_action(chat_id: int, action: str = "typing") -> None:
    await _api("sendChatAction", {"chat_id": chat_id, "action": action})


async def send_voice(chat_id: int, ogg_bytes: bytes, *, caption: str | None = None) -> bool:
    """Send a native voice message (OGG/Opus)."""
    data: dict = {"chat_id": str(chat_id)}
    if caption:
        data["caption"] = caption[:1024]
    files = {"voice": ("voice.ogg", ogg_bytes, "audio/ogg")}
    return bool(await _api("sendVoice", data, files=files))


async def get_file_path(file_id: str) -> str | None:
    result = await _api("getFile", {"file_id": file_id})
    path = result.get("file_path")
    return str(path) if path else None


async def download_file(file_path: str) -> bytes | None:
    """Download a file the bot was sent (e.g. a voice note)."""
    if not telegram_ready():
        return None
    url = f"{_API_ROOT}/file/bot{get_settings().telegram_bot_token}/{file_path}"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content
    except Exception:
        log.exception("telegram: file download failed")
        return None


# ── Voice synthesis (outbound) ────────────────────────────────────────────────


async def synthesize_voice_ogg(text: str) -> bytes | None:
    """TTS → OGG/Opus for `sendVoice`. None if TTS disabled or conversion fails."""
    tts = get_tts_adapter()
    if not tts.enabled:
        return None
    try:
        audio = await tts.synthesize(text)
    except Exception:
        log.warning("telegram: TTS synthesis failed", exc_info=True)
        return None
    if not audio:
        return None
    fmt = (get_settings().tts_format or "mp3").lower()
    suffix = f".{fmt}" if fmt in {"mp3", "wav", "opus", "flac", "aac"} else ".mp3"
    return convert_to_ogg_opus(audio, input_suffix=suffix)


# ── Outbound delivery (mirrors web_push.send_push_to_user) ────────────────────


def _open_button_url(path: str | None) -> str:
    s = get_settings()
    base = s.frontend_url.rstrip("/")
    if not path:
        return f"{base}/dashboard"
    if path.startswith("http"):
        return path
    return f"{base}{path if path.startswith('/') else '/' + path}"


async def _linked_account(user_id: str) -> TelegramAccount | None:
    async with SessionLocal() as session:
        return (
            await session.execute(
                select(TelegramAccount).where(
                    TelegramAccount.user_id == user_id,
                    TelegramAccount.chat_id.is_not(None),
                )
            )
        ).scalar_one_or_none()


async def send_telegram_to_user(user_id: str, payload: dict) -> int:
    """Deliver a proactive alert to a user's linked Telegram chat. Returns send count.

    payload keys: title (str), body (str), url (str, optional), tag (str, optional).
    Respects the per-account `proactive_enabled` opt-out.
    """
    if not telegram_ready():
        return 0
    account = await _linked_account(user_id)
    if not account or not account.proactive_enabled or account.chat_id is None:
        return 0

    title = str(payload.get("title") or "").strip()
    body = str(payload.get("body") or "").strip()
    text = f"🔔 {title}\n\n{body}" if title else body
    ok = await send_message(
        account.chat_id,
        text,
        url_button=("Open in Briefly", _open_button_url(payload.get("url"))),
    )
    return 1 if ok else 0


async def send_brief_ready(user_id: str, digest: Digest | None = None) -> bool:
    """Notify a linked user that today's brief is ready, with the top headlines."""
    if not telegram_ready():
        return False
    account = await _linked_account(user_id)
    if not account or account.chat_id is None:
        return False

    async with SessionLocal() as session:
        if digest is None:
            user = (
                await session.execute(select(User).where(User.id == user_id))
            ).scalar_one_or_none()
            tz = getattr(getattr(user, "profile", None), "digest_timezone", None) or "UTC"
            digest = (
                await session.execute(
                    select(Digest).where(
                        Digest.user_id == user_id,
                        Digest.digest_date == local_date_string(tz),
                    )
                )
            ).scalar_one_or_none()
            if digest is None:
                digest = (
                    await session.execute(
                        select(Digest)
                        .where(Digest.user_id == user_id)
                        .order_by(Digest.digest_date.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
        if digest is None:
            return False

        items = (
            await session.execute(
                select(DigestItem)
                .where(DigestItem.digest_id == digest.id)
                .order_by(DigestItem.position.asc())
                .limit(3)
            )
        ).scalars().all()

    headline = digest.subject_line or "Your brief is ready"
    lines = [f"📰 {headline}"]
    if digest.preview_text:
        lines.append(digest.preview_text)
    if items:
        lines.append("")
        lines.extend(f"• {it.headline}" for it in items)
    lines.append("\nAsk me anything about it — type or send a voice note.")

    return await send_message(
        account.chat_id,
        "\n".join(lines),
        url_button=("Read the full brief", _open_button_url(f"/dashboard/read/{digest.id}")),
    )


# ── Webhook registration ──────────────────────────────────────────────────────


async def register_webhook() -> bool:
    """Point Telegram at our webhook. Best-effort; called once at startup."""
    s = get_settings()
    if not telegram_ready() or not s.api_public_url:
        return False
    webhook_url = f"{s.api_public_url.rstrip('/')}/api/v1/telegram/webhook"
    payload: dict = {
        "url": webhook_url,
        "allowed_updates": ["message"],
        "drop_pending_updates": False,
    }
    if s.telegram_webhook_secret:
        payload["secret_token"] = s.telegram_webhook_secret
    ok = bool(await _api("setWebhook", payload))
    if ok:
        log.info("telegram: webhook registered at %s", webhook_url)
    else:
        log.warning("telegram: webhook registration failed for %s", webhook_url)
    return ok
