"""Sponsor block stripping in ContentCleanerAgent."""
from __future__ import annotations

from briefly_api.agents.cleaner import _strip_sponsor_blocks


def test_strip_sponsored_by_block():
    text = (
        "Real story about AI agents shipping today. "
        "Sponsored by Acme Corp — get 20% off widgets. "
        "More real coverage continues here."
    )
    out = _strip_sponsor_blocks(text)
    assert "Sponsored by" not in out
    assert "AI agents" in out
