"""AudioAgent skip rules — never download TTS during briefing generation."""
from __future__ import annotations

from briefly_api.agents.audio import should_skip_tts
from briefly_api.auth.google import GoogleTokenRevoked, raise_if_google_refresh_rejected


def test_skip_tts_on_web_even_for_pro():
    assert (
        should_skip_tts(
            process_role="web",
            audio_enabled=False,
            is_pro=True,
            model_ready=True,
        )
        == "web_process"
    )


def test_skip_tts_when_model_missing():
    assert (
        should_skip_tts(
            process_role="worker",
            audio_enabled=True,
            is_pro=True,
            model_ready=False,
        )
        == "model_not_cached"
    )


def test_run_tts_on_worker_when_cached():
    assert (
        should_skip_tts(
            process_role="worker",
            audio_enabled=False,
            is_pro=True,
            model_ready=True,
        )
        is None
    )


def test_skip_tts_when_disabled_for_free():
    assert (
        should_skip_tts(
            process_role="all",
            audio_enabled=False,
            is_pro=False,
            model_ready=True,
        )
        == "disabled"
    )


class _FakeResp:
    def __init__(self, status_code: int, text: str = '{"error":"invalid_grant"}'):
        self.status_code = status_code
        self.text = text


def test_google_refresh_400_is_revoked():
    try:
        raise_if_google_refresh_rejected(_FakeResp(400), "YouTube")
        raise AssertionError("expected GoogleTokenRevoked")
    except GoogleTokenRevoked:
        pass
    raise_if_google_refresh_rejected(_FakeResp(200), "YouTube")
