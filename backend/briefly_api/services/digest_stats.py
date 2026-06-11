"""Closing stats card and monthly time-saved rollup for digests."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import get_settings
from briefly_api.db.models import Digest


def format_duration_minutes(minutes: int) -> str:
    minutes = max(0, int(minutes))
    if minutes < 60:
        return f"~{minutes}m"
    hours = minutes // 60
    remainder = minutes % 60
    if remainder == 0:
        return f"~{hours}h"
    return f"~{hours}h {remainder}m"


async def monthly_stats(session: AsyncSession, user_id: str) -> dict[str, Any]:
    """Aggregate digest columns over the trailing 30 days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    result = await session.execute(
        select(
            func.coalesce(func.sum(Digest.total_items_ingested), 0),
            func.coalesce(func.sum(Digest.total_items_shown), 0),
            func.count(Digest.id),
        ).where(
            Digest.user_id == user_id,
            Digest.digest_date >= cutoff,
        )
    )
    ingested, shown, digest_count = result.one()
    ingested = int(ingested or 0)
    shown = int(shown or 0)
    skipped = max(0, ingested - shown)
    avg_min = get_settings().avg_read_minutes
    saved_minutes = int(skipped * avg_min)
    return {
        "items_ingested": ingested,
        "items_shown": shown,
        "items_skipped": skipped,
        "digest_count": int(digest_count or 0),
        "time_saved_minutes": saved_minutes,
        "time_saved_label": format_duration_minutes(saved_minutes),
        "avg_read_minutes": avg_min,
    }


def merged_story_count(items: list[Any]) -> int:
    return sum(1 for item in items if int(getattr(item, "duplicate_count", 1) or 1) > 1)


def source_count_for_digest(
    digest: Any,
    items: list[Any],
    *,
    fallback: int | None = None,
) -> int:
    included = getattr(digest, "sources_included", None) or []
    if included:
        return len(included)
    names = {
        getattr(item, "source_name", None)
        for item in items
        if getattr(item, "source_name", None)
    }
    if names:
        return len(names)
    return int(fallback or 0)


def build_closing_stats(
    digest: Any,
    items: list[Any],
    monthly: dict[str, Any],
    *,
    source_count_fallback: int | None = None,
) -> dict[str, Any]:
    ingested = int(getattr(digest, "total_items_ingested", 0) or 0)
    shown = int(getattr(digest, "total_items_shown", 0) or 0) or len(items)
    sources = source_count_for_digest(digest, items, fallback=source_count_fallback)
    merged = merged_story_count(items)
    saved_label = monthly.get("time_saved_label") or format_duration_minutes(0)
    avg_min = monthly.get("avg_read_minutes") or get_settings().avg_read_minutes

    closing_line = (
        f"That's everything that matters today. "
        f"Briefly read {ingested} items from your {sources} sources and brought you {shown}. "
        f"Time saved this month: {saved_label} (est.)."
    )
    dedup_line: str | None = None
    if merged > 0:
        story_word = "story" if merged == 1 else "stories"
        dedup_line = (
            f"{merged} {story_word} were covered by multiple sources — "
            f"merged so you read each once"
        )

    return {
        "closing_line": closing_line,
        "dedup_line": dedup_line,
        "items_ingested": ingested,
        "items_shown": shown,
        "source_count": sources,
        "merged_story_count": merged,
        "monthly_time_saved_minutes": int(monthly.get("time_saved_minutes") or 0),
        "monthly_time_saved_label": saved_label,
        "avg_read_minutes": avg_min,
    }


def render_closing_html(stats: dict[str, Any]) -> str:
    """Finite closing block — nothing should render below this in the brief."""
    dedup_html = ""
    if stats.get("dedup_line"):
        dedup_html = (
            f'<p style="margin:10px 0 0;font-size:13px;color:#888;line-height:1.55;">'
            f'{_esc(stats["dedup_line"])}</p>'
        )
    return f"""
          <div style="margin-top:40px;padding:24px 22px;background:#f4f1ff;border-radius:12px;border:1px solid #e8e4ff;">
            <p style="margin:0;font-size:11px;font-weight:700;color:#5b47e0;letter-spacing:1.6px;text-transform:uppercase;">The brief ends here</p>
            <p style="margin:12px 0 0;font-size:15px;color:#333;line-height:1.65;font-weight:500;">{_esc(stats["closing_line"])}</p>
            {dedup_html}
          </div>"""


def _esc(text: str) -> str:
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
