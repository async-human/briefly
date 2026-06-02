from __future__ import annotations

from datetime import datetime, timezone

from briefly_api.utils.dates import local_date_string


def test_local_date_string_uses_timezone():
    # 2026-06-02 22:00 UTC is already 2026-06-03 in Asia/Kolkata (UTC+5:30)
    moment = datetime(2026, 6, 2, 22, 0, tzinfo=timezone.utc)
    assert local_date_string("Asia/Kolkata", moment) == "2026-06-03"
    assert local_date_string("UTC", moment) == "2026-06-02"


def test_local_date_string_falls_back_for_invalid_timezone():
    moment = datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc)
    assert local_date_string("Not/AZone", moment) == "2026-06-02"
