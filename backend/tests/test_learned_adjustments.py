"""Tests for learned adjustment loop."""
from __future__ import annotations

from types import SimpleNamespace

from briefly_api.services.learned_adjustments import (
    build_confirmation_lines,
    confirm_in_digest,
    get_profile_meta,
    queue_adjustment,
    ready_for_confirmation,
)


def test_queue_and_confirm_adjustment():
    profile = SimpleNamespace(profile_meta={})
    adj = queue_adjustment(
        profile,
        signal_type="disliked",
        source_name="CoinDesk",
        headline="Bitcoin hits new high",
    )
    assert adj["topic_hint"]
    meta = get_profile_meta(profile)
    assert len(meta["pending_adjustments"]) == 1

    meta["pending_adjustments"][0]["applied_at"] = "2026-01-01T00:00:00+00:00"
    profile.profile_meta = meta
    assert len(ready_for_confirmation(meta)) == 1

    confirm_in_digest(profile, "digest-1", {adj["id"]: 4})
    remaining = get_profile_meta(profile)["pending_adjustments"]
    assert remaining == []


def test_build_confirmation_lines_with_filter_count():
    adjustments = [
        {"id": "a1", "signal_type": "disliked", "topic_hint": "crypto funding"},
    ]
    lines = build_confirmation_lines(adjustments, {"a1": 4})
    assert lines
    assert "4 items were filtered" in lines[0]
