"""
Per-topic briefing exposure and behavioral signals — single source of truth.

Scans digest items in a time window, attributes stories to tracked topics via
shared matching rules, then layers save/skip/click signals on those items.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import BehavioralSignal, Digest, DigestItem, SignalType
from briefly_api.services.profile_utils import cluster_label
from briefly_api.services.topic_matching import TOPIC_STOP_WORDS, item_matches_topic

DEFAULT_WINDOW_DAYS = 45

# Common English words that must never surface as "emerging topics"
_EMERGING_LABEL_STOP_WORDS = TOPIC_STOP_WORDS | frozenset({
    "about", "above", "across", "after", "again", "against", "along", "among",
    "around", "because", "before", "being", "below", "between", "beyond",
    "during", "every", "first", "found", "getting", "going", "great",
    "having", "inside", "into", "just", "large", "later", "little", "local",
    "major", "makes", "making", "might", "money", "month", "never", "newer",
    "often", "other", "ought", "outside", "people", "place", "power",
    "really", "right", "since", "small", "still", "story", "stories",
    "takes", "taking", "their", "there", "these", "thing", "things", "think",
    "those", "three", "through", "today", "under", "until", "using", "very",
    "watch", "where", "which", "while", "world", "would", "years", "young",
    "announces", "announced", "report", "reports", "update", "updates",
    "analysis", "inside", "latest", "weekly", "daily",
})
THREAD_MIN_BRIEFING_DAYS = 3

_POS_TYPES = frozenset({
    SignalType.saved, SignalType.clicked, SignalType.followed_up,
})
_NEG_TYPES = frozenset({SignalType.skipped, SignalType.disliked})
_SIGNAL_TYPES = _POS_TYPES | _NEG_TYPES


def interest_topic_label(interest: object) -> str | None:
    if isinstance(interest, str):
        label = interest.strip()
        return label or None
    if isinstance(interest, dict):
        label = (interest.get("topic") or "").strip()
        return label or None
    return None


def build_tracked_topics(profile) -> dict[str, dict]:
    """
    Map normalized topic key → {display, source}.

    Declared interests always included; cluster labels added when learned.
    """
    topics: dict[str, dict] = {}
    for interest in profile.interests or []:
        label = interest_topic_label(interest)
        if not label:
            continue
        key = label.lower()
        topics[key] = {"display": label, "source": "declared"}

    declared_keys = set(topics.keys())
    for entry in profile.topic_clusters or []:
        label = cluster_label(entry)
        if not label:
            continue
        key = label.lower()
        if key in declared_keys:
            continue
        source = entry.get("source") or "inferred"
        strength = float(entry.get("strength", 0))
        item_count = int(entry.get("item_count", 0))
        if source in {"inferred", "learned"} or (strength >= 0.2 and item_count >= 1):
            topics[key] = {"display": label, "source": "discovered"}

    return topics


@dataclass
class TopicBriefingStat:
    display: str
    source: str
    stories_shown: int = 0
    briefing_days: int = 0
    saves: int = 0
    engaged: int = 0
    skipped: int = 0
    total_actions: int = 0
    latest_headline: str | None = None
    first_briefing_date: str | None = None

    @property
    def rate(self) -> float:
        return round(self.engaged / self.total_actions, 3) if self.total_actions else 0.0

    def to_api_dict(self) -> dict:
        return {
            "rate": self.rate,
            "stories_shown": self.stories_shown,
            "briefing_days": self.briefing_days,
            "engaged": self.engaged,
            "saves": self.saves,
            "skipped": self.skipped,
            "total": self.total_actions,
            "ready": self.stories_shown >= 1,
            "source": self.source,
        }


@dataclass
class TopicBriefingAnalytics:
    window_days: int
    tracked_topics: dict[str, dict]
    topic_stats: dict[str, TopicBriefingStat]
    signals: list = field(default_factory=list)
    briefing_item_count: int = 0
    computed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def latest_signal_at(self) -> datetime | None:
        times = [s.created_at for s in self.signals if s.created_at]
        return max(times) if times else None


def aggregate_topic_stats(
    tracked_topics: dict[str, dict],
    briefing_rows,
    signals,
) -> dict[str, TopicBriefingStat]:
    """Attribute briefing items to topics and roll up behavioral signals."""
    topic_item_ids: dict[str, list[str]] = defaultdict(list)
    topic_dates: dict[str, set[str]] = defaultdict(set)
    topic_latest: dict[str, str] = {}
    seen_per_topic: dict[str, set[str]] = defaultdict(set)

    topic_keys = list(tracked_topics.keys())

    for row in briefing_rows:
        item_id = str(row.id)
        digest_date = str(row.digest_date) if row.digest_date else ""
        for key in topic_keys:
            if not item_matches_topic(
                row.headline,
                row.summary,
                row.source_name,
                row.confidence_signal,
                key,
            ):
                continue
            if item_id not in seen_per_topic[key]:
                seen_per_topic[key].add(item_id)
                topic_item_ids[key].append(item_id)
            if digest_date:
                topic_dates[key].add(digest_date)
            if key not in topic_latest and row.headline:
                topic_latest[key] = row.headline

    signals_by_item: dict[str, list] = defaultdict(list)
    for sig in signals:
        if sig.digest_item_id:
            signals_by_item[str(sig.digest_item_id)].append(sig)

    stats: dict[str, TopicBriefingStat] = {}
    for key, meta in tracked_topics.items():
        matching_ids = topic_item_ids.get(key, [])
        saves = engaged = skipped = 0
        for item_id in matching_ids:
            for sig in signals_by_item.get(item_id, []):
                if sig.signal_type == SignalType.saved:
                    saves += 1
                    engaged += 1
                elif sig.signal_type in _POS_TYPES:
                    engaged += 1
                elif sig.signal_type in _NEG_TYPES:
                    skipped += 1

        dates = topic_dates.get(key, set())
        first_date = min(dates) if dates else None
        stats[key] = TopicBriefingStat(
            display=meta["display"],
            source=meta["source"],
            stories_shown=len(matching_ids),
            briefing_days=len(dates),
            saves=saves,
            engaged=engaged,
            skipped=skipped,
            total_actions=engaged + skipped,
            latest_headline=topic_latest.get(key),
            first_briefing_date=first_date,
        )

    return stats


async def compute_topic_briefing_analytics(
    session: AsyncSession,
    user_id: str,
    profile,
    *,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> TopicBriefingAnalytics:
    tracked = build_tracked_topics(profile)
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)

    items_result = await session.execute(
        select(
            DigestItem.id,
            DigestItem.headline,
            DigestItem.summary,
            DigestItem.source_name,
            DigestItem.confidence_signal,
            Digest.digest_date,
        )
        .join(Digest, Digest.id == DigestItem.digest_id)
        .where(Digest.user_id == user_id, Digest.created_at >= cutoff)
        .order_by(Digest.created_at.desc())
    )
    briefing_rows = items_result.all()

    signals_result = await session.execute(
        select(
            BehavioralSignal.signal_type,
            BehavioralSignal.created_at,
            BehavioralSignal.digest_item_id,
            DigestItem.headline,
            DigestItem.source_name,
            DigestItem.summary,
        )
        .join(DigestItem, BehavioralSignal.digest_item_id == DigestItem.id)
        .where(
            BehavioralSignal.user_id == user_id,
            BehavioralSignal.created_at >= cutoff,
            BehavioralSignal.signal_type.in_(list(_SIGNAL_TYPES)),
            BehavioralSignal.digest_item_id.isnot(None),
        )
        .limit(600)
    )
    signals = signals_result.all()

    topic_stats = aggregate_topic_stats(tracked, briefing_rows, signals)

    return TopicBriefingAnalytics(
        window_days=window_days,
        tracked_topics=tracked,
        topic_stats=topic_stats,
        signals=signals,
        briefing_item_count=len(briefing_rows),
    )


def is_emerging_label(label: str) -> bool:
    """Reject headline fragments and common words — only human topic phrases."""
    clean = label.strip()
    if len(clean) < 4:
        return False

    words = [
        w.strip(".,;:!?\"'()[]").lower()
        for w in clean.replace("-", " ").split()
        if w.strip(".,;:!?\"'()[]")
    ]
    if not words:
        return False

    significant = [w for w in words if w not in _EMERGING_LABEL_STOP_WORDS and len(w) >= 2]
    if not significant:
        return False

    if len(words) == 1:
        word = words[0]
        return len(word) >= 6 and word not in _EMERGING_LABEL_STOP_WORDS

    return len(significant) >= 2 or (len(significant) == 1 and len(significant[0]) >= 5)


def build_emerging_topics(
    analytics: TopicBriefingAnalytics,
    profile=None,
    *,
    min_stories: int = 2,
    limit: int = 6,
) -> list[str]:
    """
    Topics Briefly inferred from reading that the user did not declare.

    Uses learned clusters plus briefing attribution — never raw headline tokens.
    """
    declared_keys = {
        key for key, meta in analytics.tracked_topics.items()
        if meta["source"] == "declared"
    }

    ranked: dict[str, int] = {}

    for key, stat in analytics.topic_stats.items():
        if stat.source != "discovered" or key in declared_keys:
            continue
        if stat.stories_shown < min_stories:
            continue
        if not is_emerging_label(stat.display):
            continue
        ranked[stat.display] = max(ranked.get(stat.display, 0), stat.stories_shown)

    if profile:
        for entry in profile.topic_clusters or []:
            label = cluster_label(entry)
            if not label or not is_emerging_label(label):
                continue
            key = label.lower()
            if key in declared_keys:
                continue
            source = entry.get("source") or "inferred"
            strength = float(entry.get("strength", 0))
            item_count = int(entry.get("item_count", 0))
            if source not in {"inferred", "learned"}:
                continue
            if strength < 0.08 or item_count < 2:
                continue
            stat = analytics.topic_stats.get(key)
            briefing_count = stat.stories_shown if stat else 0
            ranked[label] = max(ranked.get(label, 0), briefing_count, item_count)

    return [
        label
        for label, _ in sorted(ranked.items(), key=lambda x: x[1], reverse=True)
    ][:limit]


def build_topic_actual(analytics: TopicBriefingAnalytics) -> dict[str, dict]:
    """API shape: every declared topic plus discovered topics with briefing matches."""
    topic_actual: dict[str, dict] = {}

    for key, meta in analytics.tracked_topics.items():
        if meta["source"] != "declared":
            continue
        stat = analytics.topic_stats.get(key)
        if stat:
            topic_actual[key] = stat.to_api_dict()
        else:
            topic_actual[key] = TopicBriefingStat(
                display=meta["display"],
                source="declared",
            ).to_api_dict()

    for key, stat in analytics.topic_stats.items():
        if stat.source == "discovered" and stat.stories_shown >= 1:
            topic_actual[key] = stat.to_api_dict()

    return topic_actual


def format_active_threads(
    analytics: TopicBriefingAnalytics,
    *,
    limit: int = 8,
    min_briefing_days: int = THREAD_MIN_BRIEFING_DAYS,
) -> list[dict]:
    from briefly_api.agents.learning import _days_since

    ranked = sorted(
        analytics.topic_stats.values(),
        key=lambda s: (s.briefing_days, s.stories_shown),
        reverse=True,
    )

    threads: list[dict] = []
    for stat in ranked:
        if stat.briefing_days < min_briefing_days:
            continue
        if stat.first_briefing_date:
            days = _days_since(f"{stat.first_briefing_date}T12:00:00+00:00")
        else:
            days = 0
        weeks = max(1, round(days / 7))
        threads.append({
            "topic": stat.display,
            "weeks": weeks,
            "appearances": stat.briefing_days,
            "latest": (stat.latest_headline or "")[:100],
        })
        if len(threads) >= limit:
            break

    return threads
