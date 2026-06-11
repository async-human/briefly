"""
briefly_api/services/behavioral_fingerprint.py

Build and persist the BehavioralFingerprint for a user.

The fingerprint captures the GAP between what the user said they want
(onboarding) and what their click/save/follow-up behavior actually shows.
It is the key input that makes the writer prompt go from "generic personalized"
to "genuinely understands me".

Two entry points:
  build_and_save()  — full rebuild, called every 6 hours by SignalMonitorAgent
  load_as_text()    — returns a pre-formatted text block for the writer prompt,
                      loading from DB if available or rebuilding on the fly
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from briefly_api.db.models import (
    BehavioralFingerprint,
    BehavioralSignal,
    DigestItem,
    SignalType,
    UserProfile,
)

log = logging.getLogger(__name__)

# Lookback windows
_SHORT_WINDOW = 7    # days — "current focus"
_LONG_WINDOW  = 30   # days — engagement trends, divergence detection
_MIN_SIGNALS  = 5    # minimum signals before we attempt pattern detection
_MAX_TOPIC_HEADLINES = 3


def _append_topic_headline(headlines: list[dict], headline: str, source: str | None) -> None:
    text = headline.strip()[:140]
    if not text:
        return
    headlines[:] = [h for h in headlines if h.get("headline") != text]
    headlines.insert(0, {"headline": text, "source": source})
    del headlines[_MAX_TOPIC_HEADLINES:]


async def build_and_save(session, user_id: str) -> BehavioralFingerprint | None:
    """
    Rebuild the BehavioralFingerprint from scratch using the last 30 days of
    behavioral signals.  Upserts into `behavioral_fingerprints` table.
    """
    # ── Load profile ──────────────────────────────────────────────────────────
    result = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        return None

    declared_interests = {
        (i.get("topic") or "").strip().lower()
        for i in (profile.interests or [])
        if i.get("topic")
    }

    # ── Load signals with item context ────────────────────────────────────────
    cutoff_long  = datetime.now(timezone.utc) - timedelta(days=_LONG_WINDOW)
    cutoff_short = datetime.now(timezone.utc) - timedelta(days=_SHORT_WINDOW)
    cutoff_prior = cutoff_short - timedelta(days=_SHORT_WINDOW)

    sig_result = await session.execute(
        select(
            BehavioralSignal.signal_type,
            BehavioralSignal.created_at,
            DigestItem.headline,
            DigestItem.why_it_matters,
            DigestItem.source_name,
            DigestItem.follow_up_depth,
        )
        .join(DigestItem, BehavioralSignal.digest_item_id == DigestItem.id)
        .where(
            BehavioralSignal.user_id == user_id,
            BehavioralSignal.created_at >= cutoff_long,
        )
        .order_by(BehavioralSignal.created_at.desc())
        .limit(500)
    )
    signals = sig_result.all()

    if len(signals) < _MIN_SIGNALS:
        log.debug(
            "BehavioralFingerprint: too few signals (%d) for user %s — skipping",
            len(signals), user_id,
        )
        return None

    # ── Build topic-level engagement maps ─────────────────────────────────────
    # topic_key → stats incl. headlines for example stories in weekly UI
    topic_stats: dict[str, dict] = {}
    reads_this_week = 0
    reads_prior_week = 0

    for row in signals:
        item_text = " ".join(filter(None, [row.headline, row.why_it_matters])).lower()
        sig_type  = row.signal_type
        created = row.created_at
        if created and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        is_recent = created >= cutoff_short if created else False
        is_prior_week = (
            created >= cutoff_prior and created < cutoff_short if created else False
        )
        depth     = row.follow_up_depth or 0

        positive = sig_type in (SignalType.clicked, SignalType.saved, SignalType.followed_up)
        negative = sig_type in (SignalType.skipped, SignalType.disliked)

        if positive:
            if is_recent:
                reads_this_week += 1
            elif is_prior_week:
                reads_prior_week += 1

        for topic in declared_interests:
            words = {w for w in topic.split() if len(w) > 3}
            if not words:
                continue
            if any(w in item_text for w in words):
                stats = topic_stats.setdefault(
                    topic,
                    {"pos": 0, "neg": 0, "depths": [], "recent_pos": 0, "headlines": []},
                )
                if positive:
                    stats["pos"] += 1
                    if is_recent:
                        stats["recent_pos"] += 1
                    if depth > 0:
                        stats["depths"].append(depth)
                    headline = (row.headline or "").strip()
                    if headline:
                        _append_topic_headline(
                            stats["headlines"],
                            headline,
                            row.source_name,
                        )
                elif negative:
                    stats["neg"] += 1

    # ── High-engagement topics ────────────────────────────────────────────────
    high_engagement: list[dict] = []
    for topic, stats in topic_stats.items():
        total = stats["pos"] + stats["neg"]
        if total < 2:
            continue
        engagement_rate = stats["pos"] / total
        avg_depth = sum(stats["depths"]) / len(stats["depths"]) if stats["depths"] else 0.0
        follow_up_count = len(stats["depths"])

        if engagement_rate >= 0.6 or follow_up_count >= 2:
            high_engagement.append({
                "topic": topic,
                "engagement_rate": round(engagement_rate, 2),
                "follow_up_count": follow_up_count,
                "avg_depth": round(avg_depth, 1),
                "recent_pos": stats.get("recent_pos", 0),
                "click_count": stats["pos"],
                "examples": list(stats.get("headlines") or [])[:2],
            })

    high_engagement.sort(key=lambda x: (x["follow_up_count"], x["engagement_rate"]), reverse=True)

    # ── Low-engagement (declared but ignored) topics ──────────────────────────
    low_engagement: list[dict] = []
    for topic in declared_interests:
        stats = topic_stats.get(topic)
        if stats is None:
            # No signals at all — could be coverage gap, not necessarily ignored
            continue
        total = stats["pos"] + stats["neg"]
        if total < 2:
            continue
        skip_rate = stats["neg"] / total
        if skip_rate >= 0.70:
            low_engagement.append({
                "topic": topic,
                "declared": True,
                "actual_clicks": stats["pos"],
                "skip_count": stats["neg"],
                "examples": list(stats.get("headlines") or [])[:2],
            })

    # ── Depth preference score ────────────────────────────────────────────────
    all_depths = [row.follow_up_depth for row in signals if row.follow_up_depth and row.follow_up_depth > 0]
    depth_score = min(1.0, sum(all_depths) / (len(all_depths) * 3.0)) if all_depths else 0.3

    # ── Mind shifts (compare recent 7d vs prior 23d) ──────────────────────────
    mind_shifts: list[dict] = []
    for topic, stats in topic_stats.items():
        recent_pos = stats.get("recent_pos", 0)
        old_pos    = stats["pos"] - recent_pos
        # Rough signal: declining if user engaged before but not recently
        examples = list(stats.get("headlines") or [])[:2]
        if old_pos >= 3 and recent_pos == 0:
            mind_shifts.append({
                "topic": topic,
                "direction": "declining",
                "evidence": f"clicked {old_pos}x in last month but 0x in last week",
                "examples": examples,
            })
        elif recent_pos >= 3 and old_pos == 0:
            mind_shifts.append({
                "topic": topic,
                "direction": "rising",
                "evidence": f"0 clicks before last week, then {recent_pos}x recently",
                "examples": examples,
            })

    # ── Coverage gaps (declared interests with no matching content surfaced) ─
    coverage_gaps: list[str] = []
    for topic in declared_interests:
        stats = topic_stats.get(topic)
        if stats is None:
            coverage_gaps.append(topic)

    # ── Current focus (top engaged topics in last 7 days) ────────────────────
    recent_focus_topics = [
        t["topic"]
        for t in sorted(high_engagement, key=lambda x: x.get("follow_up_count", 0), reverse=True)
        if topic_stats.get(t["topic"], {}).get("recent_pos", 0) > 0
    ][:3]
    current_focus = ", ".join(recent_focus_topics) if recent_focus_topics else ""

    # ── Upsert fingerprint ────────────────────────────────────────────────────
    existing = await session.execute(
        select(BehavioralFingerprint).where(BehavioralFingerprint.user_id == user_id)
    )
    fp = existing.scalar_one_or_none()

    reading_time_pattern = {
        "reads_this_week": reads_this_week,
        "reads_prior_week": reads_prior_week,
    }

    if fp:
        fp.high_engagement_topics = high_engagement[:10]
        fp.low_engagement_topics  = low_engagement[:10]
        fp.depth_preference_score = round(depth_score, 3)
        fp.coverage_gaps          = coverage_gaps[:10]
        fp.mind_shifts            = mind_shifts[:6]
        fp.current_focus          = current_focus
        fp.reading_time_pattern   = reading_time_pattern
        fp.total_signals_analyzed = len(signals)
    else:
        fp = BehavioralFingerprint(
            user_id=user_id,
            high_engagement_topics=high_engagement[:10],
            low_engagement_topics=low_engagement[:10],
            depth_preference_score=round(depth_score, 3),
            coverage_gaps=coverage_gaps[:10],
            mind_shifts=mind_shifts[:6],
            current_focus=current_focus,
            reading_time_pattern=reading_time_pattern,
            total_signals_analyzed=len(signals),
        )
        session.add(fp)

    await session.flush()
    log.info(
        "BehavioralFingerprint: rebuilt for user %s "
        "(hi=%d lo=%d shifts=%d gaps=%d signals=%d)",
        user_id,
        len(high_engagement), len(low_engagement),
        len(mind_shifts), len(coverage_gaps), len(signals),
    )
    return fp


async def load_as_text(session, user_id: str) -> str:
    """
    Load the most-recent BehavioralFingerprint for a user and format it as a
    human-readable text block for injection into the writer prompt.

    Falls back to a generic placeholder if no fingerprint exists yet.
    """
    result = await session.execute(
        select(BehavioralFingerprint).where(BehavioralFingerprint.user_id == user_id)
    )
    fp = result.scalar_one_or_none()

    if not fp:
        return "No behavioral data yet — profile based on onboarding answers only."

    lines: list[str] = []

    if fp.current_focus:
        lines.append(f"Current focus (last 7 days): {fp.current_focus}")

    if fp.high_engagement_topics:
        top = fp.high_engagement_topics[:5]
        parts = []
        for t in top:
            desc = t.get("topic", "")
            fu   = t.get("follow_up_count", 0)
            rate = t.get("engagement_rate", 0)
            if fu >= 2:
                parts.append(f"{desc} ({fu} follow-ups, avg depth {t.get('avg_depth', 0):.1f})")
            else:
                parts.append(f"{desc} ({int(rate * 100)}% engagement rate)")
        lines.append("Engages deeply with: " + "; ".join(parts))

    if fp.low_engagement_topics:
        ignored = [t.get("topic", "") for t in fp.low_engagement_topics[:3]]
        lines.append(f"Consistently ignores (despite declaring interest): {', '.join(ignored)}")

    depth_label = (
        "deep reader" if fp.depth_preference_score >= 0.65
        else "quick scanner" if fp.depth_preference_score <= 0.35
        else "mixed depth"
    )
    lines.append(f"Reading depth: {depth_label} (score {fp.depth_preference_score:.2f})")

    if fp.coverage_gaps:
        lines.append(f"Coverage gaps (no recent content): {', '.join(fp.coverage_gaps[:4])}")

    if fp.mind_shifts:
        shift_parts = []
        for s in fp.mind_shifts[:3]:
            shift_parts.append(
                f"{s.get('topic', '')} → {s.get('direction', '')} ({s.get('evidence', '')})"
            )
        lines.append("Mind shifts detected: " + "; ".join(shift_parts))

    return "\n".join(lines) if lines else "Behavioral data available but no strong patterns detected yet."
