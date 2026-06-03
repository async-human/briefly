"""
briefly_api/workers/signal_processor.py

Real-time signal processing — called from the API routes after a
BehavioralSignal is saved to the database.

This is NOT a loop.  It is a thin dispatcher that runs synchronously in the
API request path for low-cost operations and spawns background tasks for
expensive ones (fingerprint rebuild).

The existing LearningAgent runs post-digest (after all items are delivered).
This module handles IMMEDIATE effects:
  - Topic cluster micro-update on every high-intent signal
  - BehavioralFingerprint rebuild trigger on high-intent signal
  - Follow-up depth tracking for ProactiveSurfacingAgent

Usage (in the signal API route):
    from briefly_api.workers.signal_processor import handle_signal
    await handle_signal(session, user_id, signal_type, digest_item_id, meta)
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import SignalType

log = logging.getLogger(__name__)


async def handle_signal(
    session: AsyncSession,
    user_id: str,
    signal_type: SignalType,
    digest_item_id: str | None = None,
    meta: dict | None = None,
) -> None:
    """
    Dispatch signal to SignalMonitorAgent.
    Called from the API route after the signal row is committed.

    Runs the cheap immediate update synchronously (cluster micro-update).
    Spawns fingerprint rebuild as a background task to keep the request fast.
    """
    from briefly_api.agents.proactive.signal_monitor import process_signal
    from briefly_api.config import get_settings

    s = get_settings()
    if not s.signal_monitor_enabled:
        return

    try:
        await process_signal(
            session=session,
            user_id=user_id,
            signal_type=signal_type,
            digest_item_id=digest_item_id,
            meta=meta,
        )
    except Exception:
        # Signal processing must never break the API route
        log.debug("signal_processor: process_signal failed silently", exc_info=True)
