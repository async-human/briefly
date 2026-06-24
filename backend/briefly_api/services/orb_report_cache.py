"""Short-lived cache of the user's last orb report (for email follow-ups)."""
from __future__ import annotations

import time

_TTL_SECONDS = 3600
_CACHE: dict[str, dict] = {}


def store_report(user_id: str, topic: str, body: str) -> None:
    if not user_id or not body:
        return
    _CACHE[user_id] = {
        "topic": (topic or "").strip(),
        "body": (body or "").strip(),
        "at": time.monotonic(),
    }


def get_report(user_id: str) -> dict | None:
    entry = _CACHE.get(user_id)
    if not entry:
        return None
    if time.monotonic() - float(entry.get("at") or 0) > _TTL_SECONDS:
        _CACHE.pop(user_id, None)
        return None
    return entry
