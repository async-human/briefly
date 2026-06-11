"""Pending and applied feedback adjustments — closes the learning loop."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm.attributes import flag_modified

from briefly_api.services.feedback_learned import _topic_from_headline
from briefly_api.services.topic_matching import item_matches_topic, topic_match_text, topic_matches


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _touch_profile_meta(profile) -> None:
    try:
        flag_modified(profile, "profile_meta")
    except Exception:
        pass


def get_profile_meta(profile) -> dict:
    return dict(getattr(profile, "profile_meta", None) or {})


def get_pending(meta: dict) -> list[dict]:
    return list(meta.get("pending_adjustments") or [])


def queue_adjustment(
    profile,
    *,
    signal_type: str,
    source_name: str | None,
    headline: str,
) -> dict:
    """Record a pending adjustment after user feedback."""
    meta = get_profile_meta(profile)
    pending = get_pending(meta)
    topic_hint = _topic_from_headline(headline)
    entry = {
        "id": str(uuid.uuid4()),
        "signal_type": signal_type,
        "topic_hint": topic_hint,
        "source_name": (source_name or "").strip() or None,
        "created_at": _now_iso(),
        "applied_at": None,
        "applied_in_digest_id": None,
        "filtered_count": None,
    }
    pending.append(entry)
    meta["pending_adjustments"] = pending[-20:]
    profile.profile_meta = meta
    _touch_profile_meta(profile)
    return entry


def ready_for_confirmation(meta: dict) -> list[dict]:
    """Adjustments applied by learning but not yet confirmed in a digest."""
    return [
        adj for adj in get_pending(meta)
        if adj.get("applied_at") and not adj.get("applied_in_digest_id")
    ]


def mark_applied_from_learning(profile, *, topic_hint: str | None, source_name: str | None) -> bool:
    """Mark pending adjustments as applied when learning updates weights."""
    meta = get_profile_meta(profile)
    changed = False
    for adj in get_pending(meta):
        if adj.get("applied_at"):
            continue
        pending_topic = adj.get("topic_hint")
        if topic_hint and pending_topic:
            if (
                topic_hint == pending_topic
                or topic_matches(topic_hint, pending_topic)
                or topic_matches(pending_topic, topic_hint)
            ):
                adj["applied_at"] = _now_iso()
                changed = True
        elif source_name and adj.get("source_name") and adj["source_name"].lower() == source_name.lower():
            adj["applied_at"] = _now_iso()
            changed = True
    if changed:
        meta["pending_adjustments"] = get_pending(meta)
        profile.profile_meta = meta
        _touch_profile_meta(profile)
    return changed


def confirm_in_digest(
    profile,
    digest_id: str,
    drop_counts: dict[str, int],
) -> None:
    """Attach digest id and filtered counts; remove confirmed rows from pending."""
    meta = get_profile_meta(profile)
    remaining: list[dict] = []
    for adj in get_pending(meta):
        if adj.get("applied_at") and not adj.get("applied_in_digest_id"):
            adj["applied_in_digest_id"] = digest_id
            adj["filtered_count"] = int(drop_counts.get(adj["id"], 0))
            continue
        if adj.get("applied_in_digest_id"):
            continue
        remaining.append(adj)
    meta["pending_adjustments"] = remaining
    profile.profile_meta = meta
    _touch_profile_meta(profile)


def count_drop_for_adjustments(
    dropped_items: list[Any],
    adjustments: list[dict],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for adj in adjustments:
        topic = adj.get("topic_hint")
        if not topic:
            continue
        n = 0
        for item in dropped_items:
            text = topic_match_text(
                getattr(item, "title", None),
                getattr(item, "summary", None) or getattr(item, "clean_text", None),
                getattr(item, "source_name", None),
            )
            if item_matches_topic(text, topic):
                n += 1
        counts[adj["id"]] = n
    return counts


def build_confirmation_lines(
    adjustments: list[dict],
    drop_counts: dict[str, int],
    *,
    limit: int = 2,
) -> list[str]:
    lines: list[str] = []
    for adj in adjustments[:limit]:
        topic = adj.get("topic_hint") or adj.get("source_name") or "that topic"
        count = int(drop_counts.get(adj["id"], 0))
        if adj.get("signal_type") == "disliked":
            if count > 0:
                lines.append(f"You asked for less {topic} — {count} items were filtered today.")
            else:
                lines.append(f"You asked for less {topic} — Briefly adjusted your topic weights.")
        elif adj.get("signal_type") in ("saved", "liked"):
            lines.append(f"You asked for more like {topic} — similar stories will rank higher.")
    return lines
