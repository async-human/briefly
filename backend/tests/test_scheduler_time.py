"""Scheduler time window helpers."""
from __future__ import annotations

from datetime import datetime, timezone

from briefly_api.workers.scheduler_time import (
    hhmm_to_minutes,
    is_local_time_at_or_after,
    is_utc_time_at_or_after,
)


def test_hhmm_to_minutes():
    assert hhmm_to_minutes("07:00") == 420
    assert hhmm_to_minutes("00:30") == 30


def test_is_local_time_at_or_after():
    assert is_local_time_at_or_after("07:00", "07:00")
    assert is_local_time_at_or_after("07:01", "07:00")
    assert not is_local_time_at_or_after("06:59", "07:00")


def test_is_utc_time_at_or_after():
    now = datetime(2026, 6, 10, 2, 45, tzinfo=timezone.utc)
    assert is_utc_time_at_or_after(now, 2, 30)
    assert is_utc_time_at_or_after(now, 2, 45)
    assert not is_utc_time_at_or_after(now, 3, 0)
