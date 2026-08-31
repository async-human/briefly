"""Tests for STT provider config and Deepgram response parsing."""

from briefly_api.config import Settings
from briefly_api.stt.adapter import (
    _deepgram_keyterms_from_prompt,
    _parse_deepgram_transcript,
)


def test_speech_to_text_provider_default():
    s = Settings()
    assert s.speech_to_text_provider == "openai"
    assert s.stt_provider == "openai"


def test_stt_provider_env_alias():
    s = Settings(_env_file=None, stt_provider="deepgram", deepgram_api_key="test-key")
    assert s.speech_to_text_provider == "deepgram"
    assert s.stt_provider == "deepgram"


def test_parse_deepgram_transcript():
    body = {
        "results": {
            "channels": [
                {"alternatives": [{"transcript": "Hello from Deepgram."}]},
            ],
        },
    }
    assert _parse_deepgram_transcript(body) == "Hello from Deepgram."


def test_parse_deepgram_transcript_empty_on_bad_shape():
    assert _parse_deepgram_transcript({}) == ""
    assert _parse_deepgram_transcript("not-json") == ""


def test_deepgram_keyterms_skips_stopwords():
    terms = _deepgram_keyterms_from_prompt(
        "Ignore background noise — transcribe Kubernetes and PostgreSQL only.",
    )
    assert "Kubernetes" in terms
    assert "PostgreSQL" in terms
    assert "Ignore" not in terms


def test_suffixes_to_try_prefers_real_container():
    from briefly_api.stt.audio_utils import _suffixes_to_try

    assert _suffixes_to_try(b"\x1aE\xdf\xa3rest", ".webm") == [".webm"]
    assert _suffixes_to_try(b"OggS...." + b"\x00" * 8, ".webm") == [".ogg"]
    guessed = _suffixes_to_try(b"C\xc3\x81\x03\xc0\x80\xfb\x03", ".webm")
    assert guessed[0] == ".webm"
    assert ".ogg" in guessed
    assert ".mp4" in guessed
