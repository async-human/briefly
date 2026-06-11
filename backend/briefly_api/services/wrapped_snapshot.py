"""Weekly 'Wrapped' snapshot surfaced in Monday briefings and /intelligence."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import BehavioralFingerprint

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

_SECTION_HINTS = {
    "active": "Topics you opened or saved in the last 7 days",
    "shifting": "Compared with the prior 3 weeks",
    "ignored": "Shown in your brief often, but you usually skip them",
    "uncovered": "Interests with no matching stories lately — add sources or refine wording",
    "emerging": "Threads gaining traction in your reading",
}

_ACTIONS = {
    "settings": {"label": "Edit interests", "href": "/settings"},
    "sources": {"label": "Add sources", "href": "/settings"},
    "history": {"label": "View reading history", "href": "/history"},
    "intelligence": {"label": "Full intelligence report", "href": "/intelligence#week-in-focus"},
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
        parts.append(f"{total} {noun} earlier this month")
    elif rate >= 0.6 and total > 0:
        parts.append(f"{int(rate * 100)}% open rate")

    return " · ".join(parts) if parts else "Engaged recently"


def _ignored_detail(topic: dict) -> str:
    skips = int(topic.get("skip_count") or 0)
    clicks = int(topic.get("actual_clicks") or 0)
    if skips and clicks:
        return f"{skips} skipped · {clicks} opened"
    if skips:
        return f"{skips} skipped recently"
    return "Usually skipped when shown"


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


def _normalize_examples(raw) -> list[dict]:
    if not raw:
        return []
    out: list[dict] = []
    for item in raw[:2]:
        if isinstance(item, str):
            text = item.strip()
            if text:
                out.append({"headline": text[:140], "source": None})
        elif isinstance(item, dict):
            headline = (item.get("headline") or "").strip()
            if headline:
                out.append({
                    "headline": headline[:140],
                    "source": item.get("source"),
                })
    return out


def _normalize_thread_entry(entry) -> dict | None:
    if isinstance(entry, str):
        topic = entry.strip()
        return {"topic": topic, "detail": "", "examples": []} if topic else None
    if isinstance(entry, dict):
        topic = (entry.get("topic") or entry.get("thread") or "").strip()
        if not topic:
            return None
        detail = (entry.get("evidence") or entry.get("detail") or entry.get("reason") or "").strip()
        return {
            "topic": topic,
            "detail": detail,
            "examples": _normalize_examples(entry.get("examples")),
        }
    return None


def _week_delta_label(this_week: int, prior_week: int) -> str:
    if this_week == 0 and prior_week == 0:
        return ""
    delta = this_week - prior_week
    if delta > 0:
        return f"{delta} more read{'s' if delta != 1 else ''} than last week"
    if delta < 0:
        return f"{abs(delta)} fewer read{'s' if abs(delta) != 1 else ''} than last week"
    if this_week > 0:
        return "Same pace as last week"
    return ""


def _build_synthesis(
    *,
    weekly_synthesis: str,
    active_topics: list[dict],
    shifts: list[dict],
    ignored: list[dict],
    uncovered: list[dict],
    week_delta: str,
) -> str:
    if weekly_synthesis:
        return weekly_synthesis

    parts: list[str] = []
    if week_delta:
        parts.append(f"You had {week_delta}.")

    if active_topics:
        names = [t["topic"] for t in active_topics[:2]]
        if len(names) == 1:
            parts.append(f"Most active on {names[0]} this week.")
        else:
            parts.append(f"This week you focused on {names[0]} and {names[1]}.")

    rising = [s for s in shifts if s.get("direction") == "rising"]
    declining = [s for s in shifts if s.get("direction") == "declining"]
    if rising:
        parts.append(f"{rising[0]['topic'].title()} is picking up.")
    if declining:
        parts.append(f"{declining[0]['topic'].title()} has cooled off this week.")

    if uncovered:
        names = ", ".join(u["topic"] for u in uncovered[:2])
        parts.append(f"Briefly hasn't surfaced stories on {names} lately — worth checking your sources.")

    if ignored and not declining:
        parts.append(
            f"You've been skipping {ignored[0]['topic']} — consider tuning that interest in Settings."
        )

    return " ".join(parts[:4])


def _build_lead(*, synthesis: str, current_focus: str) -> str:
    if synthesis:
        first = synthesis.split(".")[0].strip()
        if first:
            return first if first.endswith(".") else f"{first}."
    if current_focus:
        topics = [t.strip() for t in current_focus.split(",") if t.strip()]
        if len(topics) == 1:
            return f"Most active on {topics[0]} this week"
        if topics:
            if len(topics) == 2:
                return f"This week: {topics[0]} and {topics[1]}"
            return f"This week: {', '.join(topics[:-1])}, and {topics[-1]}"
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
    reading = fp.reading_time_pattern or {}
    reads_this_week = int(reading.get("reads_this_week") or 0)
    reads_prior_week = int(reading.get("reads_prior_week") or 0)
    week_delta = _week_delta_label(reads_this_week, reads_prior_week)

    has_signal = bool(
        fp.mind_shifts
        or current_focus
        or fp.high_engagement_topics
        or weekly_synthesis
        or weekly.get("emerging_threads")
        or fp.coverage_gaps
        or fp.low_engagement_topics
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
    ignored_keys = {_topic_key(t.get("topic", "")) for t in (fp.low_engagement_topics or [])}

    shifts = []
    for s in (fp.mind_shifts or [])[:4]:
        topic = (s.get("topic") or "").strip()
        if not topic:
            continue
        direction = s.get("direction") or "stable"
        action = _ACTIONS["settings"] if direction == "declining" else _ACTIONS["history"]
        shifts.append(
            {
                "topic": topic,
                "direction": direction,
                "label": _SHIFT_LABELS.get(direction, direction.title()),
                "detail": _shift_detail(s),
                "examples": _normalize_examples(s.get("examples")),
                "action": action,
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
        active_topics.append({
            "topic": topic,
            "detail": _engagement_detail(t),
            "examples": _normalize_examples(t.get("examples")),
            "action": _ACTIONS["history"],
        })
    active_topics = active_topics[:4]

    ignored = []
    for t in (fp.low_engagement_topics or [])[:4]:
        topic = (t.get("topic") or "").strip()
        if not topic:
            continue
        ignored.append({
            "topic": topic,
            "detail": _ignored_detail(t),
            "examples": _normalize_examples(t.get("examples")),
            "action": _ACTIONS["settings"],
        })

    uncovered = []
    for topic in (fp.coverage_gaps or [])[:6]:
        name = (topic if isinstance(topic, str) else topic.get("topic", "")).strip()
        if not name:
            continue
        key = _topic_key(name)
        if key in ignored_keys or key in shift_topics:
            continue
        uncovered.append({
            "topic": name,
            "detail": "No matching stories in your brief lately",
            "examples": [],
            "action": _ACTIONS["sources"],
        })
    uncovered = uncovered[:4]

    emerging = []
    for entry in (weekly.get("emerging_threads") or [])[:3]:
        normalized = _normalize_thread_entry(entry)
        if normalized:
            emerging.append(normalized)

    synthesis = _build_synthesis(
        weekly_synthesis=weekly_synthesis,
        active_topics=active_topics,
        shifts=shifts,
        ignored=ignored,
        uncovered=uncovered,
        week_delta=week_delta,
    )
    lead = _build_lead(synthesis=synthesis, current_focus=current_focus)

    legacy_gaps = [
        {"topic": g["topic"], "detail": g["detail"]}
        for g in uncovered
    ]

    return {
        "synthesis": synthesis,
        "lead": lead,
        "depth_trend": depth_trend,
        "depth_label": _DEPTH_LABELS.get(depth_trend, _DEPTH_LABELS["stable"]),
        "week_stats": {
            "reads_this_week": reads_this_week,
            "reads_prior_week": reads_prior_week,
            "delta_label": week_delta,
        },
        "section_hints": dict(_SECTION_HINTS),
        "shifts": shifts,
        "active_topics": active_topics,
        "ignored": ignored,
        "uncovered": uncovered,
        "emerging": emerging,
        "weekly_synthesis": synthesis,
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
        "gaps": legacy_gaps,
        "emerging_threads": emerging,
        "coverage_gaps": [g["topic"] for g in uncovered],
    }


async def get_week_in_focus(session: AsyncSession, user_id: str) -> dict | None:
    """Load the latest fingerprint and build a full week-in-focus snapshot."""
    result = await session.execute(
        select(BehavioralFingerprint).where(BehavioralFingerprint.user_id == user_id)
    )
    fp = result.scalar_one_or_none()
    if not fp:
        return None
    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return build_wrapped_snapshot(fp, run_date=run_date, force=True)
