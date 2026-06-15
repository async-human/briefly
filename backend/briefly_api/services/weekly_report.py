"""
briefly_api/services/weekly_report.py

Weekly Intelligence Report — the "Week X of your Briefly" email sent every Sunday.

Instead of a regular digest, this report surfaces the invisible work Briefly has
been doing all week: what dominated your reading, how your thinking is shifting,
what ongoing story threads are building, and what you might be missing.

This is the moment "this understands me" happens. Users screenshot this and share it.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.db.models import (
    BehavioralFingerprint,
    BehavioralSignal, Digest, DigestItem, DigestStatus, SignalType,
    User, UserMemory, UserProfile,
)
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.profile_utils import cluster_label

log = logging.getLogger(__name__)

_WEEKLY_REPORT_SYSTEM = """You are Briefly's intelligence layer. You analyze a user's week of reading behavior
and write a thoughtful, personal weekly intelligence report.

Your voice: the trusted analyst who's been watching. Perceptive. Not sycophantic. Direct.

Rules:
- Write in second person ("you", "your")
- Be specific — name actual topics, not vague categories
- If you detect a genuine pattern shift, say so clearly
- The "what you're not seeing" section is a service, not a criticism
- Keep each section to 2-4 sentences maximum
- Return ONLY valid JSON. No markdown, no preamble."""

_WEEKLY_REPORT_PROMPT = """User: {user_name} (Day {digest_day} of Briefly, Week {week_number})

Profile: {profile_summary}

This week's digest items (what they read):
{items_this_week}

This week's engagement signals (what they clicked/saved/skipped):
{signals_this_week}

Active story threads being tracked:
{story_threads}

Topics with no engagement this week (potential blind spots):
{quiet_topics}

Write a weekly intelligence report with these exact sections:
1. "top_topics": list of 3-4 topics that dominated their reading this week with a brief observation about each
2. "thinking_shift": 1-2 sentences about how their thinking seems to be moving (e.g. "Three weeks ago you were reading about AI as a tool. This week everything was about AI as infrastructure.")
3. "building_thread": the most interesting ongoing story thread and what stage it's at (e.g. "You've been circling LLM reliability in production for 6 weeks — the story is getting more empirical.")
4. "blind_spot": a topic from their interests that went quiet this week that had significant activity — framed as a useful heads-up, not criticism
5. "week_number": integer (e.g. 12)
6. "stories_read": integer count of items read this week
7. "top_source": name of the source they engaged with most

Return JSON:
{{
  "top_topics": [
    {{"topic": "...", "observation": "..."}},
    ...
  ],
  "thinking_shift": "...",
  "building_thread": "...",
  "blind_spot": "...",
  "week_number": 0,
  "stories_read": 0,
  "top_source": "..."
}}"""


async def generate_weekly_report(
    session: AsyncSession,
    user_id: str,
) -> dict | None:
    """
    Generate the weekly intelligence report for a user.
    Returns a dict with all report fields, or None if insufficient data.
    """
    # Load user + profile
    result = await session.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user or not user.profile:
        return None

    profile = user.profile
    digests, all_items, lookback_days = await _load_recent_digest_items(session, user_id)

    fp_result = await session.execute(
        select(BehavioralFingerprint).where(BehavioralFingerprint.user_id == user_id)
    )
    fingerprint = fp_result.scalar_one_or_none()

    if not all_items:
        if fingerprint and _fingerprint_has_report_data(fingerprint):
            return _enrich_report(
                _report_from_fingerprint(fingerprint, profile, user, stories_read=0),
                profile,
                user,
            )
        log.info("WeeklyReport: no digest items in lookback for user %s — skipping", user_id)
        return None

    if fingerprint and _fingerprint_has_report_data(fingerprint):
        report = _report_from_fingerprint(
            fingerprint,
            profile,
            user,
            stories_read=len(all_items),
            items=all_items,
        )
        return _enrich_report(report, profile, user)

    cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    # Fetch behavioral signals in the same window
    signal_result = await session.execute(
        select(BehavioralSignal.signal_type, DigestItem.headline, DigestItem.source_name)
        .join(DigestItem, BehavioralSignal.digest_item_id == DigestItem.id)
        .where(
            BehavioralSignal.user_id == user_id,
            BehavioralSignal.created_at >= cutoff,
        )
        .limit(100)
    )
    signals = signal_result.all()

    # Fetch active story threads
    thread_result = await session.execute(
        select(UserMemory)
        .where(
            UserMemory.user_id == user_id,
            UserMemory.memory_type == "story_thread",
        )
        .order_by(UserMemory.occurrence_count.desc())
        .limit(10)
    )
    threads = list(thread_result.scalars().all())

    # Compute digest day number
    digest_day = profile.total_digests_received or len(digests)
    week_number = max(1, digest_day // 7)

    # Build prompt context
    profile_summary = _build_profile_summary(profile)
    items_summary = _build_items_summary(all_items)
    signals_summary = _build_signals_summary(signals)
    threads_summary = _build_threads_summary(threads)
    quiet_topics = _build_quiet_topics(profile, all_items, signals)

    prompt = _WEEKLY_REPORT_PROMPT.format(
        user_name=user.name or "there",
        digest_day=digest_day,
        week_number=week_number,
        profile_summary=profile_summary,
        items_this_week=items_summary,
        signals_this_week=signals_summary,
        story_threads=threads_summary,
        quiet_topics=quiet_topics,
    )

    llm = get_llm_adapter()
    try:
        report = await llm.complete_json(
            messages=[Message(role="user", content=prompt)],
            system=_WEEKLY_REPORT_SYSTEM,
            user_id=user_id,
            agent="weekly_report",
        )
    except Exception:
        log.exception("WeeklyReport: LLM call failed for user %s", user_id)
        report = _fallback_report(all_items, signals, threads, week_number)

    if not report:
        return None

    return _enrich_report(report, profile, user, fallback_stories_read=len(all_items))


async def _load_recent_digest_items(
    session: AsyncSession,
    user_id: str,
) -> tuple[list[Digest], list[DigestItem], int]:
    """Load digest items from the last 7/14/30 days (by digest_date)."""
    for days in (7, 14, 30):
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        digest_result = await session.execute(
            select(Digest)
            .options(selectinload(Digest.items))
            .where(
                Digest.user_id == user_id,
                Digest.digest_date >= cutoff_date,
                Digest.status.in_((DigestStatus.ready, DigestStatus.sent)),
            )
            .order_by(Digest.digest_date.desc())
        )
        digests = list(digest_result.scalars().all())
        all_items = [item for digest in digests for item in digest.items]
        if all_items:
            return digests, all_items, days
    return [], [], 7


def _fingerprint_has_report_data(fp: BehavioralFingerprint) -> bool:
    snap = fp.weekly_snapshot or {}
    return bool(
        snap.get("weekly_synthesis")
        or snap.get("mind_shifts")
        or snap.get("emerging_threads")
        or fp.current_focus
        or fp.mind_shifts
        or fp.high_engagement_topics
    )


def _report_from_fingerprint(
    fp: BehavioralFingerprint,
    profile: UserProfile,
    user: User,
    *,
    stories_read: int,
    items: list[DigestItem] | None = None,
) -> dict:
    snap = fp.weekly_snapshot or {}
    mind_shifts = snap.get("mind_shifts") or fp.mind_shifts or []
    emerging = snap.get("emerging_threads") or []
    coverage_gaps = snap.get("coverage_gaps") or fp.coverage_gaps or []

    thinking_shift = (snap.get("weekly_synthesis") or fp.current_focus or "").strip()
    if not thinking_shift and mind_shifts:
        first = mind_shifts[0] if isinstance(mind_shifts[0], dict) else {}
        thinking_shift = (
            first.get("evidence")
            or first.get("summary")
            or first.get("topic")
            or ""
        ).strip()

    building_thread = ""
    if emerging:
        first_thread = emerging[0] if isinstance(emerging[0], dict) else {}
        building_thread = (
            first_thread.get("summary")
            or first_thread.get("thread")
            or first_thread.get("topic")
            or ""
        ).strip()
    if not building_thread and mind_shifts:
        first = mind_shifts[0] if isinstance(mind_shifts[0], dict) else {}
        building_thread = (first.get("topic") or "").strip()

    blind_spot = ""
    if coverage_gaps:
        gap = coverage_gaps[0]
        blind_spot = gap if isinstance(gap, str) else str(gap.get("topic") or gap.get("label") or "")

    top_topics: list[dict[str, str]] = []
    for topic in (fp.high_engagement_topics or [])[:4]:
        if not isinstance(topic, dict):
            continue
        name = (topic.get("topic") or "").strip()
        if not name:
            continue
        follow_ups = int(topic.get("follow_up_count") or 0)
        observation = (
            f"{follow_ups} deep dives this month" if follow_ups else "Consistently engaged"
        )
        top_topics.append({"topic": name, "observation": observation})

    if not top_topics and fp.current_focus:
        top_topics.append(
            {
                "topic": fp.current_focus[:80],
                "observation": "Your strongest focus area this week.",
            }
        )

    top_sources: dict[str, int] = {}
    for item in items or []:
        if item.source_name:
            top_sources[item.source_name] = top_sources.get(item.source_name, 0) + 1
    top_source = max(top_sources, key=top_sources.get) if top_sources else ""

    digest_day = profile.total_digests_received or 1
    week_number = max(1, digest_day // 7)

    return {
        "top_topics": top_topics,
        "thinking_shift": thinking_shift or "Your reading patterns are still taking shape.",
        "building_thread": building_thread,
        "blind_spot": blind_spot,
        "week_number": week_number,
        "stories_read": stories_read or len(items or []),
        "top_source": top_source,
    }


def _enrich_report(
    report: dict,
    profile: UserProfile,
    user: User,
    *,
    fallback_stories_read: int = 0,
) -> dict:
    digest_day = profile.total_digests_received or 1
    week_number = max(1, digest_day // 7)
    report["digest_day"] = digest_day
    report["user_name"] = user.name
    report["digest_date"] = datetime.now(timezone.utc).strftime("%B %d, %Y")
    if not report.get("week_number"):
        report["week_number"] = week_number
    if not report.get("stories_read"):
        report["stories_read"] = fallback_stories_read
    if not report.get("top_topics"):
        report["top_topics"] = []
    for key in ("thinking_shift", "building_thread", "blind_spot", "top_source"):
        report.setdefault(key, "")
    return report


def _build_profile_summary(profile: UserProfile) -> str:
    parts = []
    if profile.role:
        parts.append(f"Role: {profile.role}")
    if profile.goal:
        parts.append(f"Goal: {profile.goal[:120]}")
    interests = [
        (i.get("topic") or "").strip()
        for i in (profile.interests or [])
        if i.get("topic")
    ]
    if interests:
        parts.append(f"Declared interests: {', '.join(interests[:6])}")
    clusters = profile.topic_clusters or []
    top_clusters = sorted(clusters, key=lambda x: x.get("strength", 0), reverse=True)[:5]
    cluster_labels = [cluster_label(c) for c in top_clusters if cluster_label(c)]
    if cluster_labels:
        parts.append(f"Inferred top interests: {', '.join(cluster_labels)}")
    return "\n".join(parts)


def _build_items_summary(items: list) -> str:
    if not items:
        return "No items this week."
    lines = []
    for item in items[:30]:
        source = item.source_name or ""
        lines.append(f"- [{item.section or 'General'}] {item.headline} ({source})")
    return "\n".join(lines)


def _build_signals_summary(signals: list) -> str:
    if not signals:
        return "No engagement signals this week."
    lines = []
    for sig_type, headline, source in signals[:20]:
        action = {
            SignalType.clicked: "clicked",
            SignalType.saved: "saved",
            SignalType.followed_up: "followed up on",
            SignalType.skipped: "skipped",
            SignalType.disliked: "disliked",
        }.get(sig_type, str(sig_type))
        lines.append(f"- {action}: {headline or '(unknown)'} ({source or ''})")
    return "\n".join(lines)


def _build_threads_summary(threads: list) -> str:
    if not threads:
        return "No active story threads yet."
    lines = []
    for t in threads[:6]:
        val = t.value or {}
        occ = t.occurrence_count or 1
        latest = val.get("latest_headline", "")[:60]
        lines.append(f"- '{t.key}': {occ} appearances, latest: {latest}")
    return "\n".join(lines)


def _build_quiet_topics(profile: UserProfile, items: list, signals: list) -> str:
    """Find declared interests that had no engagement this week."""
    interests = [
        (i.get("topic") or "").strip().lower()
        for i in (profile.interests or [])
        if i.get("topic")
    ]
    if not interests:
        return "None identified."

    # Topics that appeared in clicked/saved signals this week
    engaged_text = " ".join(
        f"{headline} {source}"
        for _, headline, source in signals
        if headline
    ).lower()

    quiet = []
    for topic in interests:
        words = {w for w in topic.split() if len(w) > 3}
        if words and not any(w in engaged_text for w in words):
            quiet.append(topic)

    if not quiet:
        return "All declared interests had some engagement this week."
    return ", ".join(quiet[:4])


def _fallback_report(
    items: list,
    signals: list,
    threads: list,
    week_number: int,
) -> dict:
    """Simple fallback if LLM is unavailable."""
    top_sources: dict[str, int] = {}
    for item in items:
        if item.source_name:
            top_sources[item.source_name] = top_sources.get(item.source_name, 0) + 1
    top_source = max(top_sources, key=top_sources.get) if top_sources else ""

    engaged_count = sum(
        1 for sig, _, _ in signals
        if sig in (SignalType.clicked, SignalType.saved, SignalType.followed_up)
    )
    top_thread = threads[0].key if threads else ""

    return {
        "top_topics": [{"topic": top_source, "observation": "Most read source this week."}],
        "thinking_shift": "Keep reading to build a clearer picture of your evolving interests.",
        "building_thread": f"You've been following '{top_thread}'." if top_thread else "",
        "blind_spot": "",
        "week_number": week_number,
        "stories_read": len(items),
        "top_source": top_source,
    }
