"""Weekly 'Wrapped' snapshot surfaced in Monday briefings."""
from __future__ import annotations

from datetime import datetime


def should_surface_wrapped(run_date: str) -> bool:
    """Surface wrapped on Mondays and on the first digest of each week."""
    try:
        return datetime.strptime(run_date, "%Y-%m-%d").weekday() == 0
    except ValueError:
        return False


def build_wrapped_snapshot(fp, *, run_date: str, force: bool = False) -> dict | None:
    """
    Build a shareable weekly intelligence snapshot from BehavioralFingerprint.
    Returns None when there is insufficient data or it's not a surfacing day.
    """
    if not fp:
        return None

    has_signal = bool(
        fp.mind_shifts
        or fp.current_focus
        or fp.high_engagement_topics
        or (fp.weekly_snapshot or {}).get("weekly_synthesis")
    )
    if not has_signal:
        return None
    if not force and not should_surface_wrapped(run_date) and not fp.mind_shifts:
        return None

    weekly = fp.weekly_snapshot or {}
    high = []
    for t in (fp.high_engagement_topics or [])[:4]:
        topic = t.get("topic", "")
        if not topic:
            continue
        fu = t.get("follow_up_count", 0)
        high.append(
            {
                "topic": topic,
                "detail": f"{fu} deep dives" if fu >= 2 else "high engagement",
            }
        )

    shifts = []
    for s in (fp.mind_shifts or [])[:4]:
        shifts.append(
            {
                "topic": s.get("topic", ""),
                "direction": s.get("direction", ""),
                "evidence": s.get("evidence", ""),
            }
        )

    return {
        "current_focus": fp.current_focus or "",
        "depth_trend": weekly.get("depth_trend") or "stable",
        "weekly_synthesis": weekly.get("weekly_synthesis") or "",
        "mind_shifts": shifts,
        "high_engagement": high,
        "emerging_threads": (weekly.get("emerging_threads") or [])[:3],
        "coverage_gaps": (fp.coverage_gaps or [])[:3],
    }
