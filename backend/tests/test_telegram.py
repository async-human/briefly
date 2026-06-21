"""Telegram channel — outbound payload, webhook auth, inbound routing, formatting.

DB-touching internals (link handshake, orb turn) are exercised by manual E2E per
the plan; these are fast unit tests with monkeypatching, mirroring test_orb.py.
"""
from __future__ import annotations

import asyncio
import types

import briefly_api.api.routes.telegram as routes_telegram
import briefly_api.services.telegram as tg
import briefly_api.services.telegram_bot as bot


def _account(**over):
    base = dict(
        id="acc1",
        user_id="u1",
        chat_id=555,
        telegram_user_id=1,
        username="harshal",
        thread_id=None,
        voice_replies=True,
        proactive_enabled=True,
    )
    base.update(over)
    return types.SimpleNamespace(**base)


# ── _format_answer (pure) ─────────────────────────────────────────────────────


def test_format_answer_plain():
    out = bot._format_answer("Here's the gist.", None)
    assert out == "Here's the gist."


def test_format_answer_with_transcript_and_citations():
    out = bot._format_answer(
        "AI moved fast.",
        [{"title": "OpenAI ships", "url": "https://x.com/a"}, {"source_name": "The Verge"}],
        transcript="what's new in AI",
    )
    assert out.startswith('🎙 "what\'s new in AI"')
    assert "AI moved fast." in out
    assert "1. OpenAI ships" in out and "https://x.com/a" in out
    assert "2. The Verge" in out


def test_format_answer_fallback_when_empty():
    out = bot._format_answer("", None)
    assert "couldn't find" in out.lower()


# ── send_telegram_to_user (outbound, mirrors web_push) ────────────────────────


def test_send_telegram_to_user_composes_message(monkeypatch):
    sent = {}

    async def fake_account(user_id):
        return _account()

    async def fake_send(chat_id, text, *, url_button=None, disable_preview=True):
        sent["chat_id"] = chat_id
        sent["text"] = text
        sent["button"] = url_button
        return True

    monkeypatch.setattr(tg, "telegram_ready", lambda: True)
    monkeypatch.setattr(tg, "_linked_account", fake_account)
    monkeypatch.setattr(tg, "send_message", fake_send)
    monkeypatch.setattr(
        tg, "get_settings",
        lambda: types.SimpleNamespace(frontend_url="https://app.briefly"),
    )

    n = asyncio.run(tg.send_telegram_to_user("u1", {"title": "Breaking", "body": "Big news", "url": "/dashboard"}))
    assert n == 1
    assert sent["chat_id"] == 555
    assert "Breaking" in sent["text"] and "Big news" in sent["text"]
    assert sent["button"][1] == "https://app.briefly/dashboard"


def test_send_telegram_respects_opt_out(monkeypatch):
    async def fake_account(user_id):
        return _account(proactive_enabled=False)

    monkeypatch.setattr(tg, "telegram_ready", lambda: True)
    monkeypatch.setattr(tg, "_linked_account", fake_account)
    n = asyncio.run(tg.send_telegram_to_user("u1", {"title": "x", "body": "y"}))
    assert n == 0


def test_send_telegram_noop_when_not_linked(monkeypatch):
    async def fake_account(user_id):
        return None

    monkeypatch.setattr(tg, "telegram_ready", lambda: True)
    monkeypatch.setattr(tg, "_linked_account", fake_account)
    assert asyncio.run(tg.send_telegram_to_user("u1", {"title": "x", "body": "y"})) == 0


# ── webhook auth ──────────────────────────────────────────────────────────────


class _FakeRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


def test_webhook_rejects_bad_secret(monkeypatch):
    called = {"n": 0}

    async def fake_handle(update):
        called["n"] += 1

    monkeypatch.setattr(routes_telegram, "handle_update", fake_handle)
    settings = types.SimpleNamespace(telegram_webhook_secret="right")
    res = asyncio.run(
        routes_telegram.telegram_webhook(
            _FakeRequest({"message": {}}),
            x_telegram_bot_api_secret_token="wrong",
            settings=settings,
        )
    )
    assert res == {"ok": False}
    assert called["n"] == 0


def test_webhook_accepts_good_secret(monkeypatch):
    called = {"n": 0}

    async def fake_handle(update):
        called["n"] += 1

    monkeypatch.setattr(routes_telegram, "handle_update", fake_handle)
    settings = types.SimpleNamespace(telegram_webhook_secret="right")
    res = asyncio.run(
        routes_telegram.telegram_webhook(
            _FakeRequest({"message": {"chat": {"id": 1}, "text": "hi"}}),
            x_telegram_bot_api_secret_token="right",
            settings=settings,
        )
    )
    assert res == {"ok": True}
    assert called["n"] == 1


# ── inbound routing (DB-free via monkeypatched seams) ─────────────────────────


def _quiet_telegram(monkeypatch):
    """Stub all network sends so routing tests stay offline."""
    async def noop(*a, **k):
        return True

    monkeypatch.setattr(bot, "send_chat_action", noop)


def test_route_unlinked_prompts_to_connect(monkeypatch):
    msgs = []

    async def fake_account(chat_id, session=None):
        return None

    async def fake_send(chat_id, text, **k):
        msgs.append(text)
        return True

    monkeypatch.setattr(bot, "_account_for_chat", fake_account)
    monkeypatch.setattr(bot, "send_message", fake_send)
    asyncio.run(bot._route({"message": {"chat": {"id": 9}, "text": "hello"}}))
    assert msgs and "Settings" in msgs[0]


def test_route_start_parses_code(monkeypatch):
    captured = {}

    async def fake_start(chat_id, code, from_user):
        captured["chat_id"] = chat_id
        captured["code"] = code

    monkeypatch.setattr(bot, "_handle_start", fake_start)
    asyncio.run(
        bot._route({"message": {"chat": {"id": 9}, "from": {"id": 3}, "text": "/start ABC123"}})
    )
    assert captured == {"chat_id": 9, "code": "ABC123"}


def test_route_text_runs_turn_and_replies(monkeypatch):
    msgs = []
    _quiet_telegram(monkeypatch)

    async def fake_account(chat_id, session=None):
        return _account()

    async def fake_turn(account, **kwargs):
        assert kwargs.get("text") == "what's up"
        return {"answer": "Lots.", "citations": []}

    async def fake_send(chat_id, text, **k):
        msgs.append(text)
        return True

    monkeypatch.setattr(bot, "_account_for_chat", fake_account)
    monkeypatch.setattr(bot, "_run_turn", fake_turn)
    monkeypatch.setattr(bot, "send_message", fake_send)
    asyncio.run(bot._route({"message": {"chat": {"id": 555}, "text": "what's up"}}))
    assert msgs == ["Lots."]


def test_route_voice_replies_with_text_and_voice(monkeypatch):
    events = {"text": None, "voice": False}
    _quiet_telegram(monkeypatch)

    async def fake_account(chat_id, session=None):
        return _account(voice_replies=True)

    async def fake_path(file_id):
        return "voice/file.oga"

    async def fake_download(path):
        return b"OGGDATA"

    async def fake_turn(account, **kwargs):
        assert kwargs.get("audio_bytes") == b"OGGDATA"
        return {"answer": "Heard you.", "citations": [], "transcript": "hey briefly"}

    async def fake_send(chat_id, text, **k):
        events["text"] = text
        return True

    async def fake_synth(text):
        return b"OGGREPLY"

    async def fake_voice(chat_id, ogg, **k):
        events["voice"] = ogg == b"OGGREPLY"
        return True

    monkeypatch.setattr(bot, "_account_for_chat", fake_account)
    monkeypatch.setattr(bot, "get_file_path", fake_path)
    monkeypatch.setattr(bot, "download_file", fake_download)
    monkeypatch.setattr(bot, "_run_turn", fake_turn)
    monkeypatch.setattr(bot, "send_message", fake_send)
    monkeypatch.setattr(bot, "synthesize_voice_ogg", fake_synth)
    monkeypatch.setattr(bot, "send_voice", fake_voice)

    asyncio.run(
        bot._route({"message": {"chat": {"id": 555}, "voice": {"file_id": "fid"}}})
    )
    assert "Heard you." in events["text"]
    assert 'hey briefly' in events["text"]
    assert events["voice"] is True
