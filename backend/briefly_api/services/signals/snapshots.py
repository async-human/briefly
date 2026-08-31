"""Entity snapshots — versioned last-known state per watched entity + aspect.

Sprint 1 leftover / Phase 2 temporal asset. previous_state on a signal
comes from the latest snapshot, not merely the previous signal row.
Corroborating coverage of the same observation does not write a new snapshot
and does not invent a state change.
"""
from __future__ import annotations

import re
from typing import Any

from briefly_api.services.operating_context import distinctive_tokens
from briefly_api.services.signals.detectors import DETECTOR_TYPES

_PCT = re.compile(r"(\d+(?:\.\d+)?)\s*%")
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


def same_observation(left: str, right: str) -> bool:
    """True when two claims describe the same observed state, not a new change."""
    a = normalize_state(left).lower()
    b = normalize_state(right).lower()
    if not a or not b:
        return False
    if a == b:
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
    if len(shared) >= 3:
        return True
    return len(shared) / len(ta | tb) >= 0.5


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
            .order_by(EntitySnapshot.observed_at.desc())
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
) -> str | None:
    text = normalize_state(state_text)[:500]
    if not text or aspect not in DETECTOR_TYPES:
        return None
    import uuid

    from briefly_api.db.models import EntitySnapshot

    snap = EntitySnapshot(
        id=str(uuid.uuid4()),
        user_id=user_id,
        entity_id=entity_id,
        aspect=aspect,
        state_text=text,
        source_url=(source_url or "")[:2000],
        signal_id=signal_id,
    )
    session.add(snap)
    return snap.id


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
                "observed_at": row.observed_at,
            }
        )
    return out
