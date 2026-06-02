from __future__ import annotations

from datetime import datetime, timezone

import pytz


def local_date_string(tz_name: str, now_utc: datetime | None = None) -> str:
    """Calendar date (YYYY-MM-DD) in the given IANA timezone."""
    moment = now_utc or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    try:
        tz = pytz.timezone(tz_name or "UTC")
    except Exception:
        tz = pytz.UTC
    return moment.astimezone(tz).strftime("%Y-%m-%d")
