"""Tests for Hindi localization helper."""
from __future__ import annotations

from briefly_api.services.brief_localization import _has_devanagari, _needs_hindi


def test_has_devanagari():
    assert _has_devanagari("यह हिंदी है") is True
    assert _has_devanagari("This is English") is False


def test_needs_hindi():
    assert _needs_hindi("English summary here with enough length") is True
    assert _needs_hindi("यह पहले से हिंदी में है") is False
    assert _needs_hindi("") is False
