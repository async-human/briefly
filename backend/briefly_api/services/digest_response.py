"""Build DigestOut API payloads with computed closing stats."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.api.schemas import DigestItemOut, DigestOut, DigestStatsOut
from briefly_api.db.models import Digest
from briefly_api.services.digest_stats import build_closing_stats, monthly_stats
from briefly_api.services.score_explain import why_this_summary


async def digest_to_out(digest: Digest, db: AsyncSession) -> DigestOut:
    monthly = await monthly_stats(db, digest.user_id)
    stats = build_closing_stats(digest, list(digest.items or []), monthly)
    items = list(digest.items or [])
    bundles: dict = {}
    try:
        from briefly_api.services.signals.attach import evidence_for_items

        bundles = await evidence_for_items(db, digest.user_id, items)
    except Exception:
        bundles = {}
    items_out: list[DigestItemOut] = []
    for orm_item in items:
        item = DigestItemOut.model_validate(orm_item)
        summary = why_this_summary(
            dict(orm_item.score_breakdown or {}),
            source_name=orm_item.source_name,
        )
        bundle = bundles.get(orm_item.id) or {}
        pieces = list(bundle.get("pieces") or [])
        items_out.append(
            item.model_copy(
                update={
                    "why_this_summary": summary,
                    "signal_id": bundle.get("signal_id"),
                    "detector_type": bundle.get("detector_type"),
                    "signal_confidence": bundle.get("confidence"),
                    "previous_state": bundle.get("previous_state") or None,
                    "new_state": bundle.get("new_state") or None,
                    "signal_label": bundle.get("label"),
                    "evidence": pieces,
                }
            )
        )
    base = DigestOut.model_validate(digest)
    return base.model_copy(
        update={
            "items": items_out,
            "stats": DigestStatsOut.model_validate(stats),
        }
    )
