"""
briefly_api/services/telegram_bot.py

Inbound Telegram update handling — the bot is a window into the orb brain, not a
second assistant. Every text/voice turn flows through `run_orb_turn` (the same
STT → Ask Briefly → grounded answer path the dashboard orb uses), with
conversation continuity via the per-chat `thread_id`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import TelegramAccount, User
from briefly_api.services.orb import run_orb_turn
from briefly_api.services.telegram import (
    download_file,
    get_file_path,
    send_brief_ready,
    send_chat_action,
    send_message,
    send_voice,
    synthesize_voice_ogg,
)

log = logging.getLogger(__name__)

_HELP = (
    "I'm Briefly 👋 — your morning brief, on Telegram.\n\n"
    "• Ask me anything about your sources — *type* or send a *voice note*.\n"
    "• /brief — today's briefing\n"
    "• /voice on|off — voice-note replies (default on)\n"
    "• /stop — pause proactive alerts · /resume — turn them back on\n"
    "• /unlink — disconnect this chat"
)


async def handle_update(update: dict) -> None:
    """Process one Telegram update. Swallows its own errors — the webhook must 200."""
    try:
        await _route(update)
    except Exception:
        log.exception("telegram: handle_update failed")


async def _route(update: dict) -> None:
    message = update.get("message") or update.get("edited_message")
    if not isinstance(message, dict):
        return
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        return
    from_user = message.get("from") or {}
    text = (message.get("text") or "").strip()

    # ── Linking handshake: /start <code> ──
    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        await _handle_start(chat_id, parts[1].strip() if len(parts) > 1 else "", from_user)
        return

    account = await _account_for_chat(chat_id)
    if account is None:
        await send_message(
            chat_id,
            "You're not connected yet. Open Briefly → Settings → Connect Telegram to link "
            "your account, then come back here.",
        )
        return

    # ── Slash commands ──
    if text.startswith("/"):
        await _handle_command(account, chat_id, text)
        return

    # ── Voice / audio note → orb (STT happens inside run_orb_turn) ──
    voice = message.get("voice") or message.get("audio")
    if isinstance(voice, dict) and voice.get("file_id"):
        await _handle_voice(account, chat_id, voice["file_id"])
        return

    # ── Plain text question → orb ──
    if text:
        await _handle_text(account, chat_id, text)
        return

    await send_message(chat_id, "Send me a question as text or a voice note and I'll answer from your brief.")


# ── Linking ───────────────────────────────────────────────────────────────────


async def _handle_start(chat_id: int, code: str, from_user: dict) -> None:
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        account = None
        if code:
            account = (
                await session.execute(
                    select(TelegramAccount).where(TelegramAccount.link_code == code)
                )
            ).scalar_one_or_none()

        valid = (
            account is not None
            and account.link_code_expires_at is not None
            and account.link_code_expires_at >= now
        )
        if not valid:
            existing = await _account_for_chat(chat_id, session)
            if existing is not None:
                await send_message(chat_id, "You're already connected ✅. Ask me anything about your brief.")
            else:
                await send_message(
                    chat_id,
                    "That link is invalid or expired. Generate a fresh one in "
                    "Briefly → Settings → Connect Telegram.",
                )
            return

        # Release any prior binding of this chat to a different account.
        prior = (
            await session.execute(
                select(TelegramAccount).where(
                    TelegramAccount.chat_id == chat_id,
                    TelegramAccount.id != account.id,
                )
            )
        ).scalar_one_or_none()
        if prior is not None:
            prior.chat_id = None
            prior.linked_at = None

        account.chat_id = chat_id
        account.telegram_user_id = from_user.get("id")
        account.username = from_user.get("username")
        account.linked_at = now
        account.link_code = None
        account.link_code_expires_at = None
        await session.commit()

    await send_message(
        chat_id,
        "Connected ✅ — you're talking to Briefly now.\n\n" + _HELP,
    )


# ── Commands ──────────────────────────────────────────────────────────────────


async def _handle_command(account: TelegramAccount, chat_id: int, text: str) -> None:
    cmd = text.split()[0].lower().lstrip("/").split("@")[0]

    if cmd in {"help", "start"}:
        await send_message(chat_id, _HELP)
    elif cmd == "brief":
        if not await send_brief_ready(account.user_id):
            await send_message(chat_id, "Your briefing isn't ready yet — check back in a few minutes.")
    elif cmd == "voice":
        arg = text.split()[1].lower() if len(text.split()) > 1 else ""
        on = arg in {"on", "true", "1", "yes"}
        await _set_flag(account.id, voice_replies=on)
        await send_message(chat_id, f"Voice replies are now {'on 🔊' if on else 'off 🔇'}.")
    elif cmd == "stop":
        await _set_flag(account.id, proactive_enabled=False)
        await send_message(chat_id, "Proactive alerts paused. Send /resume to turn them back on.")
    elif cmd == "resume":
        await _set_flag(account.id, proactive_enabled=True)
        await send_message(chat_id, "Proactive alerts resumed 🔔")
    elif cmd == "unlink":
        await _set_flag(account.id, chat_id=None, linked_at=None)
        await send_message(chat_id, "Disconnected. Reconnect anytime from Briefly → Settings.")
    else:
        await send_message(chat_id, "I didn't recognize that command.\n\n" + _HELP)


# ── Conversational turns ──────────────────────────────────────────────────────


async def _handle_text(account: TelegramAccount, chat_id: int, text: str) -> None:
    await send_chat_action(chat_id, "typing")
    result = await _run_turn(account, text=text)
    if result is None:
        await send_message(chat_id, "Something went wrong on my end — try again in a moment.")
        return
    await send_message(chat_id, _format_answer(result.get("answer"), result.get("citations")))


async def _handle_voice(account: TelegramAccount, chat_id: int, file_id: str) -> None:
    await send_chat_action(chat_id, "typing")
    file_path = await get_file_path(file_id)
    audio = await download_file(file_path) if file_path else None
    if not audio:
        await send_message(chat_id, "I couldn't download that voice note — try sending it again.")
        return

    result = await _run_turn(
        account, audio_bytes=audio, filename="voice.oga", content_type="audio/ogg"
    )
    if result is None:
        await send_message(chat_id, "I couldn't make that out — try again, a little slower.")
        return

    answer = result.get("answer") or ""
    await send_message(
        chat_id,
        _format_answer(answer, result.get("citations"), transcript=result.get("transcript")),
    )

    # Voice-note reply (the "talk to your briefing" loop), if enabled.
    if account.voice_replies and answer:
        await send_chat_action(chat_id, "record_voice")
        ogg = await synthesize_voice_ogg(answer)
        if ogg:
            await send_voice(chat_id, ogg)


async def _run_turn(
    account: TelegramAccount,
    *,
    text: str | None = None,
    audio_bytes: bytes | None = None,
    filename: str = "speech.webm",
    content_type: str = "audio/webm",
) -> dict | None:
    """Run one orb turn for this account, persisting the rolling thread_id."""
    async with SessionLocal() as session:
        user = await _load_user(session, account.user_id)
        if user is None:
            return None
        try:
            result = await run_orb_turn(
                session,
                user,
                text=text,
                audio_bytes=audio_bytes,
                filename=filename,
                content_type=content_type,
                thread_id=account.thread_id,
            )
        except ValueError:
            return None
        except Exception:
            log.exception("telegram: orb turn failed for user %s", account.user_id)
            return None

        new_thread = result.get("thread_id")
        if new_thread and new_thread != account.thread_id:
            db_account = await session.get(TelegramAccount, account.id)
            if db_account is not None:
                db_account.thread_id = new_thread
                account.thread_id = new_thread
        await session.commit()
        return result


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _account_for_chat(
    chat_id: int, session: AsyncSession | None = None
) -> TelegramAccount | None:
    async def _q(s: AsyncSession) -> TelegramAccount | None:
        return (
            await s.execute(select(TelegramAccount).where(TelegramAccount.chat_id == chat_id))
        ).scalar_one_or_none()

    if session is not None:
        return await _q(session)
    async with SessionLocal() as s:
        return await _q(s)


async def _load_user(session: AsyncSession, user_id: str) -> User | None:
    return (
        await session.execute(
            select(User).options(selectinload(User.profile)).where(User.id == user_id)
        )
    ).scalar_one_or_none()


async def _set_flag(account_id: str, **fields: object) -> None:
    async with SessionLocal() as session:
        account = await session.get(TelegramAccount, account_id)
        if account is None:
            return
        for key, value in fields.items():
            setattr(account, key, value)
        await session.commit()


def _format_answer(answer: str | None, citations: list | None, *, transcript: str | None = None) -> str:
    parts: list[str] = []
    if transcript:
        parts.append(f'🎙 "{transcript}"\n')
    parts.append((answer or "I couldn't find anything on that in your sources.").strip())

    cites = [c for c in (citations or []) if isinstance(c, dict)][:3]
    if cites:
        parts.append("")
        for i, c in enumerate(cites, start=1):
            title = c.get("title") or c.get("source_name") or "source"
            url = c.get("url")
            parts.append(f"{i}. {title}" + (f"\n{url}" if url else ""))
    return "\n".join(parts)
