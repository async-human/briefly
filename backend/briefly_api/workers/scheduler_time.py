"""Time helpers for digest / ingestion scheduling (window-based, not exact-minute)."""
from __future__ import annotations

from datetime import datetime


def hhmm_to_minutes(hhmm: str) -> int:
    hour_str, minute_str = hhmm.strip().split(":", 1)
    return int(hour_str) * 60 + int(minute_str)


def is_local_time_at_or_after(local_hhmm: str, scheduled_hhmm: str) -> bool:
    """True when local clock has reached or passed scheduled HH:MM today."""
    return hhmm_to_minutes(local_hhmm) >= hhmm_to_minutes(scheduled_hhmm)


def is_utc_time_at_or_after(now_utc: datetime, hour: int, minute: int = 0) -> bool:
    now_minutes = now_utc.hour * 60 + now_utc.minute
    target = hour * 60 + minute
    return now_minutes >= target
