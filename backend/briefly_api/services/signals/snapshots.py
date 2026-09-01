"""Entity snapshots — versioned last-known state per watched entity + aspect.

Sprint 1 leftover / Phase 2 temporal asset. previous_state on a signal
comes from the latest snapshot, not merely the previous signal row.
Corroborating coverage of the same observation does not write a new snapshot
and does not invent a state change.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Any

from briefly_api.services.operating_context import distinctive_tokens
from briefly_api.services.signals.detectors import DETECTOR_TYPES

_PCT = re.compile(r"(\d+(?:\.\d+)?)\s*%")
_MONEY = re.compile(
    r"(?:(?P<currency>USD|EUR|GBP|INR)\s*)?(?P<symbol>[$€£₹])?\s*"
    r"(?P<amount>\d+(?:\.\d+)?)\s*(?P<scale>[kKmMbB])?"
)
_VERSION = re.compile(
    r"\b(?:gpt|claude|gemini|llama|mistral)[-\s]?[a-z]*[-\s]?(?:\d+(?:\.\d+)?|opus|sonnet|haiku)\b",
    re.I,
)
_DOWN = re.compile(r"\b(cut|cuts|lower|lowered|drop|dropped|reduce|reduced|cheaper|discount)\b", re.I)
_UP = re.compile(r"\b(raise|raises|raised|increase|increased|hike|hiked|higher)\b", re.I)
_ASPECT_LABEL = {
    "pricing_positioning": "pricing",
    "model_api": "API",
    "product_release": "product",
}


def aspect_label(aspect: str) -> str:
    return _ASPECT_LABEL.get(aspect, aspect.replace("_", " "))


def normalize_state(text: str) -> str:
    return " ".join((text or "").split()).strip()


def _percent(text: str) -> str | None:
    m = _PCT.search(text or "")
    return m.group(1) if m else None


def extract_state_fields(text: str) -> dict[str, str | None]:
    """Extract conservative machine-comparable state without inventing a value."""
    normalized = normalize_state(text)
    pct = _percent(normalized)
    if pct is not None:
        direction = "down" if _DOWN.search(normalized) else "up" if _UP.search(normalized) else ""
        return {"value": pct, "unit": "percent", "direction": direction or None}
    version = _VERSION.search(normalized)
    if version:
        value = re.sub(r"\s+", "-", version.group(0).lower())
        return {"value": value, "unit": "version", "direction": None}
    for match in _MONEY.finditer(normalized):
        if not (match.group("currency") or match.group("symbol")):
            continue
        value = f"{match.group('amount')}{(match.group('scale') or '').lower()}"
        unit = (match.group("currency") or match.group("symbol") or "money").lower()
        direction = "down" if _DOWN.search(normalized) else "up" if _UP.search(normalized) else ""
        return {"value": value, "unit": unit, "direction": direction or None}
    return {"value": None, "unit": None, "direction": None}


def event_fingerprint(aspect: str, state_text: str, source_url: str = "") -> str:
    """Stable idempotency key that permits a reused page URL to report a new state."""
    state = normalize_state(state_text).lower()
    # Entity identity is part of the database uniqueness key. Excluding the URL
    # lets the same normalized event converge when two sources race to insert it.
    raw = f"{aspect}|{state}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def same_observation(left: str, right: str) -> bool:
    """True when two claims describe the same observed state, not a new change."""
    a = normalize_state(left).lower()
    b = normalize_state(right).lower()
    if not a or not b:
        return False
    if a == b:
        return True
    fa, fb = extract_state_fields(a), extract_state_fields(b)
    if fa["direction"] and fb["direction"] and fa["direction"] != fb["direction"]:
        return False
    if fa["unit"] and fa["unit"] == fb["unit"] and fa["value"] == fb["value"]:
        ta, tb = set(distinctive_tokens(a)), set(distinctive_tokens(b))
        if ta & tb:
            return True
    pa, pb = _percent(a), _percent(b)
    if pa and pb and pa != pb:
        return False
    if a in b or b in a:
        return True
    ta, tb = set(distinctive_tokens(a)), set(distinctive_tokens(b))
    if not ta or not tb:
        return False
    shared = ta & tb
    return len(shared) / len(ta | tb) >= 0.65


async def current_state(
    session,
    *,
    user_id: str,
    entity_id: str | None,
    aspect: str,
    exclude_url: str = "",
) -> str:
    """Latest snapshot text for this entity+aspect. Backfills from the last signal."""
    if not entity_id or aspect not in DETECTOR_TYPES:
        return ""
    from sqlalchemy import select

    from briefly_api.db.models import EntitySnapshot, MarketSignal

    row = (
        await session.execute(
            select(EntitySnapshot.state_text)
            .where(
                EntitySnapshot.user_id == user_id,
                EntitySnapshot.entity_id == entity_id,
                EntitySnapshot.aspect == aspect,
            )
            .order_by(EntitySnapshot.observed_at.desc(), EntitySnapshot.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row:
        return (row or "")[:500]

    stmt = (
        select(MarketSignal.id, MarketSignal.new_state, MarketSignal.source_url)
        .where(
            MarketSignal.user_id == user_id,
            MarketSignal.entity_id == entity_id,
            MarketSignal.detector_type == aspect,
            MarketSignal.new_state != "",
        )
        .order_by(MarketSignal.detected_at.desc())
        .limit(5)
    )
    prior = (await session.execute(stmt)).all()
    for signal_id, state, url in prior:
        if exclude_url and url == exclude_url:
            continue
        text = (state or "").strip()
        if not text:
            continue
        await record_snapshot(
            session,
            user_id=user_id,
            entity_id=entity_id,
            aspect=aspect,
            state_text=text,
            source_url=url or "",
            signal_id=signal_id,
        )
        return text[:500]
    return ""


async def record_snapshot(
    session,
    *,
    user_id: str,
    entity_id: str,
    aspect: str,
    state_text: str,
    source_url: str = "",
    signal_id: str | None = None,
    effective_at: datetime | None = None,
    fingerprint: str | None = None,
) -> str | None:
    text = normalize_state(state_text)[:500]
    if not text or aspect not in DETECTOR_TYPES:
        return None
    import uuid
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from briefly_api.db.models import EntitySnapshot

    fields = extract_state_fields(text)
    event_id = fingerprint or event_fingerprint(aspect, text, source_url)
    snapshot_id = str(uuid.uuid4())
    stmt = (
        pg_insert(EntitySnapshot)
        .values(
            id=snapshot_id,
            user_id=user_id,
            entity_id=entity_id,
            aspect=aspect,
            state_text=text,
            state_value=fields["value"],
            state_unit=fields["unit"],
            effective_at=effective_at,
            event_fingerprint=event_id,
            source_url=(source_url or "")[:2000],
            signal_id=signal_id,
        )
        .on_conflict_do_nothing()
        .returning(EntitySnapshot.id)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def resolve_states(
    session,
    *,
    user_id: str,
    entity_id: str | None,
    aspect: str,
    proposed_new: str,
    source_url: str = "",
) -> tuple[str, str, bool]:
    """Return (previous, new_for_row, write_snapshot).

    First sighting: previous empty, write snapshot.
    Same observation: both sides stay on the canonical snapshot; no write.
    Real change: previous is the snapshot, new is this claim, write snapshot.
    """
    proposed = normalize_state(proposed_new)[:500]
    current = await current_state(
        session,
        user_id=user_id,
        entity_id=entity_id,
        aspect=aspect,
        exclude_url=source_url,
    )
    if not current:
        return "", proposed, bool(proposed)
    if same_observation(current, proposed):
        return current, current, False
    return current, proposed, bool(proposed)


async def latest_by_entities(
    session,
    user_id: str,
    entity_ids: list[str],
) -> dict[str, list[dict[str, Any]]]:
    """Map entity_id → latest snapshot per aspect (most recent first)."""
    if not entity_ids:
        return {}
    from sqlalchemy import select

    from briefly_api.db.models import EntitySnapshot

    rows = (
        await session.execute(
            select(EntitySnapshot)
            .where(
                EntitySnapshot.user_id == user_id,
                EntitySnapshot.entity_id.in_(entity_ids),
            )
            .order_by(EntitySnapshot.observed_at.desc())
        )
    ).scalars().all()
    out: dict[str, list[dict[str, Any]]] = {eid: [] for eid in entity_ids}
    seen: set[tuple[str, str]] = set()
    for row in rows:
        key = (row.entity_id, row.aspect)
        if key in seen:
            continue
        seen.add(key)
        out.setdefault(row.entity_id, []).append(
            {
                "aspect": row.aspect,
                "label": aspect_label(row.aspect),
                "state": row.state_text,
                "value": row.state_value,
                "unit": row.state_unit,
                "effective_at": row.effective_at,
                "observed_at": row.observed_at,
            }
        )
    return out
