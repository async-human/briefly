"""Shared personalization signals for relevance, planning, and Top 3 ranking."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from briefly_api.agents.context import DigestItemDraft, RawItem
from briefly_api.services.digest_sections import SECTION_HIGHLY_RELEVANT
from briefly_api.services.profile_utils import cluster_label
from briefly_api.services.source_priority import build_priority_map, priority_sort_key

_STOP_WORDS = frozenset({
    "about", "after", "also", "been", "from", "have", "into", "more",
    "some", "than", "that", "their", "there", "these", "this", "those",
    "through", "under", "until", "very", "what", "when", "where", "which",
    "while", "with", "your",
})


@dataclass
class InterestModel:
    """Weighted interest phrases used for alignment scoring."""

    phrases: dict[str, float] = field(default_factory=dict)
    deprioritized_phrases: list[str] = field(default_factory=list)


def build_interest_model(
    profile: dict,
    topic_clusters: list[dict] | None = None,
    *,
    active_story_threads: list[dict] | None = None,
) -> InterestModel:
    phrases: dict[str, float] = {}

    def add_phrase(phrase: str, weight: float) -> None:
        clean = phrase.strip().lower()
        if len(clean) < 3:
            return
        phrases[clean] = max(phrases.get(clean, 0.0), weight)
        for word in clean.split():
            word = word.strip(".,;:!?\"'()")
            if len(word) > 3 and word not in _STOP_WORDS:
                phrases[word] = max(phrases.get(word, 0.0), weight * 0.55)

    role = str(profile.get("role") or "").strip()
    if role:
        add_phrase(role, 1.0)

    goal = str(profile.get("goal") or "").strip()
    if goal:
        add_phrase(goal, 1.15)
        for word in goal.split():
            word = word.strip(".,;:!?\"'()")
            if len(word) > 3 and word not in _STOP_WORDS:
                add_phrase(word, 0.75)

    for interest in profile.get("interests") or []:
        if isinstance(interest, dict):
            topic = str(interest.get("topic") or "").strip()
            weight = float(interest.get("weight") or interest.get("strength") or 1.0)
        else:
            topic = str(interest).strip()
            weight = 1.0
        if topic:
            add_phrase(topic, min(1.25, 0.85 + weight * 0.15))

    for cluster in topic_clusters or []:
        if cluster.get("_type") in {"source_weight", "meta"}:
            continue
        label = cluster_label(cluster)
        if not label:
            continue
        strength = float(cluster.get("strength") or cluster.get("weight") or 0.5)
        add_phrase(label, min(1.2, 0.55 + strength * 0.65))

    for thread in active_story_threads or []:
        key = str(thread.get("key") or "").strip()
        if key:
            strength = float(thread.get("strength") or 1.0)
            add_phrase(key, min(1.3, 0.9 + strength * 0.2))

    deprioritized: list[str] = []
    for entry in profile.get("deprioritized_topics") or []:
        if isinstance(entry, dict):
            topic = str(entry.get("topic") or "").strip()
        else:
            topic = str(entry).strip()
        if topic:
            deprioritized.append(topic.lower())

    return InterestModel(phrases=phrases, deprioritized_phrases=deprioritized)


def item_search_text(item: RawItem) -> str:
    title = item.title or ""
    if item.meta.get("from_medium_digest"):
        return f"{title} {title} {title} {item.summary or ''}".lower()
    return f"{title} {item.summary or ''} {item.clean_text[:1200]} {item.source_name or ''}".lower()


def topic_alignment_score(item: RawItem, model: InterestModel) -> float:
    if not model.phrases:
        return 0.5

    text = item_search_text(item)
    score = 0.0
    hits = 0
    for phrase, weight in sorted(model.phrases.items(), key=lambda kv: len(kv[0]), reverse=True):
        if phrase in text:
            score += weight
            hits += 1

    if hits == 0:
        return 0.18

    # Diminishing returns — first strong phrase match matters most.
    return min(1.0, 0.35 + score * 0.22)


def deprioritized_penalty(item: RawItem, model: InterestModel) -> float:
    if not model.deprioritized_phrases:
        return 0.0
    text = item_search_text(item)
    if any(phrase in text for phrase in model.deprioritized_phrases):
        return 0.18
    return 0.0


def story_thread_boost(item: RawItem, memory_connections: dict[str, list[dict]] | None) -> float:
    if not memory_connections:
        return 0.0
    connections = memory_connections.get(item.id) or []
    if not connections:
        return 0.0
    strength = max(float(c.get("strength") or 1.0) for c in connections)
    return min(0.12, 0.05 + strength * 0.04)


def recency_component(item: RawItem) -> float:
    if not item.published_at:
        return 0.5
    published = item.published_at
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    age_days = (datetime.now(timezone.utc) - published).total_seconds() / 86400
    if age_days < 1:
        return 1.0
    if age_days < 3:
        return 0.88
    if age_days < 7:
        return 0.68
    if age_days < 14:
        return 0.48
    return 0.28


def personalization_rank_score(
    item: RawItem,
    *,
    priority_map: dict[str, str],
    interest_model: InterestModel | None = None,
    memory_connections: dict[str, list[dict]] | None = None,
) -> float:
    """
    Unified display rank score for planner ordering and Top 3 selection.
    Higher = more important for this user right now.
    """
    model = interest_model or InterestModel()
    alignment = topic_alignment_score(item, model)
    section_bonus = 0.06 if item.meta.get("digest_section") == SECTION_HIGHLY_RELEVANT else 0.0
    pool_bonus = 0.03 if item.meta.get("digest_pool") == "relevant" else 0.0
    priority_bonus = 0.05 if priority_sort_key(item.source_id, priority_map) == 0 else 0.0
    thread_bonus = story_thread_boost(item, memory_connections)
    penalty = deprioritized_penalty(item, model)

    score = (
        0.52 * item.relevance_score
        + 0.18 * alignment
        + 0.12 * item.novelty_score
        + 0.10 * recency_component(item)
        + section_bonus
        + pool_bonus
        + priority_bonus
        + thread_bonus
        - penalty
    )
    return round(min(1.0, max(0.0, score)), 4)


def rank_items_for_display(
    items: list[RawItem],
    *,
    priority_map: dict[str, str],
    interest_model: InterestModel | None = None,
    memory_connections: dict[str, list[dict]] | None = None,
) -> list[RawItem]:
    return sorted(
        items,
        key=lambda item: (
            -personalization_rank_score(
                item,
                priority_map=priority_map,
                interest_model=interest_model,
                memory_connections=memory_connections,
            ),
            priority_sort_key(item.source_id, priority_map),
            -item.relevance_score,
        ),
    )


def pick_top_priority_content_ids(
    drafts: list[DigestItemDraft],
    *,
    enriched_items: list[RawItem],
    profile: dict,
    topic_clusters: list[dict] | None,
    sources: list,
    memory_connections: dict[str, list[dict]] | None = None,
    limit: int = 3,
    min_score: float = 0.58,
) -> list[str]:
    if not drafts:
        return []

    item_by_id = {item.id: item for item in enriched_items}
    priority_map = build_priority_map(sources or [])
    interest_model = build_interest_model(
        profile,
        topic_clusters,
        active_story_threads=None,
    )

    ranked: list[tuple[float, DigestItemDraft, RawItem | None]] = []
    for draft in drafts:
        item = item_by_id.get(draft.content_id) if draft.content_id else None
        if item:
            rank = personalization_rank_score(
                item,
                priority_map=priority_map,
                interest_model=interest_model,
                memory_connections=memory_connections,
            )
        else:
            section_bonus = 0.06 if draft.section == SECTION_HIGHLY_RELEVANT else 0.0
            rank = 0.65 * draft.relevance_score + 0.25 * draft.novelty_score + section_bonus
        ranked.append((rank, draft, item))

    ranked.sort(key=lambda row: row[0], reverse=True)

    picked: list[str] = []
    source_counts: dict[str, int] = {}
    for rank, draft, item in ranked:
        if rank < min_score:
            continue
        if not draft.content_id:
            continue
        source_id = item.source_id if item else draft.source_name
        if source_counts.get(source_id, 0) >= 2:
            continue
        picked.append(draft.content_id)
        source_counts[source_id] = source_counts.get(source_id, 0) + 1
        if len(picked) >= limit:
            break

    if len(picked) < limit:
        for _, draft, _ in ranked:
            if not draft.content_id or draft.content_id in picked:
                continue
            picked.append(draft.content_id)
            if len(picked) >= limit:
                break

    return picked
