"""Weekly 'Wrapped' snapshot surfaced in Monday briefings."""
from __future__ import annotations

from datetime import datetime

_DEPTH_LABELS = {
    "deepening": "Reading deeper than usual",
    "shallowing": "Skimming more, fewer deep dives",
    "stable": "Steady reading pace",
}

_SHIFT_LABELS = {
    "rising": "Picking up",
    "declining": "Cooling off",
    "stable": "Steady",
}


def should_surface_wrapped(run_date: str) -> bool:
    """Surface wrapped on Mondays and on the first digest of each week."""
    try:
        return datetime.strptime(run_date, "%Y-%m-%d").weekday() == 0
    except ValueError:
        return False


def _topic_key(topic: str) -> str:
    return (topic or "").strip().lower()


def _engagement_detail(topic: dict) -> str:
    recent = int(topic.get("recent_pos") or 0)
    total = int(topic.get("click_count") or 0)
    follow_ups = int(topic.get("follow_up_count") or 0)
    rate = float(topic.get("engagement_rate") or 0)

    parts: list[str] = []
    if recent > 0:
        noun = "read" if recent == 1 else "reads"
        parts.append(f"{recent} {noun} this week")
    if follow_ups >= 2:
        parts.append(f"{follow_ups} deep dives")
    elif total > 0 and recent == 0:
        noun = "read" if total == 1 else "reads"
        parts.append(f"{total} {noun} this month")
    elif rate >= 0.6 and total > 0:
        parts.append(f"{int(rate * 100)}% open rate")

    return " · ".join(parts) if parts else "Engaged recently"


def _shift_detail(shift: dict) -> str:
    evidence = (shift.get("evidence") or "").strip()
    if evidence:
        return (
            evidence.replace("in last month but 0x in last week", "earlier this month · quiet this week")
            .replace("clicked ", "")
            .replace("0 clicks before last week, then ", "Nothing before · ")
            .replace("x recently", " reads this week")
            .replace("x in last week", " this week")
        )
    direction = shift.get("direction", "")
    if direction == "declining":
        return "Was active earlier — nothing this week"
    if direction == "rising":
        return "New interest showing up"
    return ""


def _normalize_thread_entry(entry) -> dict | None:
    if isinstance(entry, str):
        topic = entry.strip()
        return {"topic": topic, "detail": ""} if topic else None
    if isinstance(entry, dict):
        topic = (entry.get("topic") or entry.get("thread") or "").strip()
        if not topic:
            return None
        detail = (entry.get("evidence") or entry.get("detail") or entry.get("reason") or "").strip()
        return {"topic": topic, "detail": detail}
    return None


def _build_lead(*, current_focus: str, weekly_synthesis: str) -> str:
    if current_focus:
        topics = [t.strip() for t in current_focus.split(",") if t.strip()]
        if len(topics) == 1:
            return f"Most active on {topics[0]} this week"
        if topics:
            if len(topics) == 2:
                return f"This week: {topics[0]} and {topics[1]}"
            return f"This week: {', '.join(topics[:-1])}, and {topics[-1]}"
    if weekly_synthesis:
        first = weekly_synthesis.split(".")[0].strip()
        if first:
            return first if first.endswith(".") else f"{first}."
    return ""


def build_wrapped_snapshot(fp, *, run_date: str, force: bool = False) -> dict | None:
    """
    Build a shareable weekly intelligence snapshot from BehavioralFingerprint.
    Returns None when there is insufficient data or it's not a surfacing day.
    """
    if not fp:
        return None

    weekly = fp.weekly_snapshot or {}
    weekly_synthesis = (weekly.get("weekly_synthesis") or "").strip()
    current_focus = (fp.current_focus or weekly.get("current_focus") or "").strip()
    depth_trend = weekly.get("depth_trend") or "stable"

    has_signal = bool(
        fp.mind_shifts
        or current_focus
        or fp.high_engagement_topics
        or weekly_synthesis
        or weekly.get("emerging_threads")
        or fp.coverage_gaps
    )
    if not has_signal:
        return None
    if not force and not should_surface_wrapped(run_date) and not fp.mind_shifts:
        return None

    shift_topics = {_topic_key(s.get("topic", "")) for s in (fp.mind_shifts or [])}
    declining_topics = {
        _topic_key(s.get("topic", ""))
        for s in (fp.mind_shifts or [])
        if s.get("direction") == "declining"
    }

    shifts = []
    for s in (fp.mind_shifts or [])[:4]:
        topic = (s.get("topic") or "").strip()
        if not topic:
            continue
        direction = s.get("direction") or "stable"
        shifts.append(
            {
                "topic": topic,
                "direction": direction,
                "label": _SHIFT_LABELS.get(direction, direction.title()),
                "detail": _shift_detail(s),
            }
        )

    active_topics = []
    for t in (fp.high_engagement_topics or [])[:6]:
        topic = (t.get("topic") or "").strip()
        if not topic:
            continue
        key = _topic_key(topic)
        if key in declining_topics or key in shift_topics:
            continue
        if int(t.get("recent_pos") or 0) <= 0:
            continue
        active_topics.append({"topic": topic, "detail": _engagement_detail(t)})
    active_topics = active_topics[:4]

    emerging = []
    for entry in (weekly.get("emerging_threads") or [])[:3]:
        normalized = _normalize_thread_entry(entry)
        if normalized:
            emerging.append(normalized)

    gaps = []
    for topic in (fp.coverage_gaps or weekly.get("coverage_gaps") or [])[:3]:
        if isinstance(topic, str):
            name = topic.strip()
            if name:
                gaps.append(
                    {
                        "topic": name,
                        "detail": "No matching stories in your brief lately",
                    }
                )
        elif isinstance(topic, dict):
            normalized = _normalize_thread_entry(topic)
            if normalized:
                if not normalized["detail"]:
                    normalized["detail"] = "No matching stories in your brief lately"
                gaps.append(normalized)

    lead = _build_lead(current_focus=current_focus, weekly_synthesis=weekly_synthesis)

    return {
        "lead": lead,
        "depth_trend": depth_trend,
        "depth_label": _DEPTH_LABELS.get(depth_trend, _DEPTH_LABELS["stable"]),
        "weekly_synthesis": weekly_synthesis,
        "shifts": shifts,
        "active_topics": active_topics,
        "emerging": emerging,
        "gaps": gaps,
        # Legacy fields kept for older clients
        "current_focus": current_focus,
        "mind_shifts": [
            {
                "topic": s["topic"],
                "direction": s["direction"],
                "evidence": s["detail"],
            }
            for s in shifts
        ],
        "high_engagement": [
            {"topic": t["topic"], "detail": t["detail"]} for t in active_topics
        ],
        "emerging_threads": emerging,
        "coverage_gaps": [g["topic"] for g in gaps],
    }
