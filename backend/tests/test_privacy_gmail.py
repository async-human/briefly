"""Tests for Gmail privacy helpers."""
from __future__ import annotations

from briefly_api.services.privacy_gmail import _is_gmail_derived_email_source
from briefly_api.db.models import Source


def test_is_gmail_derived_email_source_true_when_flagged():
    source = Source(
        user_id="u1",
        source_type="email",
        identifier="news@example.com",
        meta={"from_gmail": True},
    )
    assert _is_gmail_derived_email_source(source) is True


def test_is_gmail_derived_email_source_false_for_forwarded():
    source = Source(
        user_id="u1",
        source_type="email",
        identifier="news@example.com",
        meta={},
    )
    assert _is_gmail_derived_email_source(source) is False


def test_is_gmail_derived_email_source_false_for_rss():
    source = Source(
        user_id="u1",
        source_type="rss",
        identifier="https://example.com/feed",
        meta={"from_gmail": True},
    )
    assert _is_gmail_derived_email_source(source) is False
