"""Tests for browser URL capture service."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from briefly_api.services.browser_capture import (
    build_capture_feedback,
    why_it_matters_for_capture,
    _ordinal_suffix,
    _thread_label,
)


def test_ordinal_suffix():
    assert _ordinal_suffix(1) == "st"
    assert _ordinal_suffix(2) == "nd"
    assert _ordinal_suffix(4) == "th"
    assert _ordinal_suffix(11) == "th"


def test_thread_label():
    assert _thread_label("ai_agent_reliability") == "ai agent reliability"


def test_build_capture_feedback_with_thread():
    row = MagicMock()
    row.meta = {}
    enrichment = MagicMock()
    enrichment.thread_key = "ai_reliability"
    enrichment.connection_sentence = "Connects to your AI reliability thread"
    enrichment.thread_update = None
    enrichment.why_relevant = "Matches your interest in agents"

    feedback = build_capture_feedback(row, enrichment, thread_item_count=4)
    assert feedback["thread_label"] == "ai reliability"
    assert "4th" in feedback["briefing_message"]
    assert feedback["connection_sentence"] == "Connects to your AI reliability thread"


def test_why_it_matters_includes_user_note():
    row = MagicMock()
    row.meta = {"user_note": "counterargument to yesterday"}
    feedback = why_it_matters_for_capture(row, None)
    assert "counterargument" in feedback


def test_capture_url_rejects_invalid_scheme():
    import asyncio
    from briefly_api.services.browser_capture import capture_url

    async def _run():
        db = AsyncMock()
        with pytest.raises(ValueError, match="valid http"):
            await capture_url(db, "user-1", "ftp://example.com/article")

    asyncio.run(_run())
