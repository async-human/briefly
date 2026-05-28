"""
briefly_api/agents/deduplication.py

DeduplicationAgent: merges items covering the same story.

Two-pass strategy:
  1. Exact dedup — items with identical content_hash or URL are merged instantly.
  2. Semantic dedup — remaining items with cosine similarity above the configured
     threshold are treated as the same story (e.g. the same news covered by 5 RSS
     feeds). The highest-quality item becomes the canonical; others become sources.

Items already in the user's seen_content_hashes (30-day history) get a novelty
penalty here so the RelevanceAgent can factor it in.
"""
from __future__ import annotations

import logging
from collections import defaultdict

import numpy as np

from briefly_api.agents.context import PipelineContext, RawItem
from briefly_api.config import get_settings

log = logging.getLogger(__name__)


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Deduplicate cleaned_items.
    Populates ctx.deduplicated_items, ctx.duplicate_groups, ctx.total_after_dedup.
    """
    s = get_settings()
    items = ctx.cleaned_items
    if not items:
        log.warning("DeduplicationAgent: no items to deduplicate")
        ctx.deduplicated_items = []
        return ctx

    # ── Pass 1: exact dedup by content_hash ──────────────────────────────────
    hash_groups: dict[str, list[RawItem]] = defaultdict(list)
    no_hash: list[RawItem] = []

    for item in items:
        if item.content_hash:
            hash_groups[item.content_hash].append(item)
        else:
            no_hash.append(item)

    candidates: list[RawItem] = []
    for group in hash_groups.values():
        canonical = _pick_canonical(group)
        _merge_duplicate_sources(canonical, group)
        candidates.append(canonical)
    candidates.extend(no_hash)

    # ── Pass 2: URL dedup (same URL = same story) ────────────────────────────
    url_groups: dict[str, list[RawItem]] = defaultdict(list)
    no_url: list[RawItem] = []

    for item in candidates:
        if item.url:
            url_groups[_normalize_url(item.url)].append(item)
        else:
            no_url.append(item)

    after_url_dedup: list[RawItem] = []
    for group in url_groups.values():
        canonical = _pick_canonical(group)
        _merge_duplicate_sources(canonical, group)
        after_url_dedup.append(canonical)
    after_url_dedup.extend(no_url)

    # ── Pass 3: semantic dedup via cosine similarity ──────────────────────────
    threshold = s.dedup_similarity_threshold
    final = _semantic_dedup(after_url_dedup, threshold)

    # ── Mark seen content ─────────────────────────────────────────────────────
    seen = ctx.user.seen_content_hashes
    for item in final:
        if item.content_hash and item.content_hash in seen:
            item.novelty_score = 0.1  # seen recently — drastically lower novelty

    ctx.deduplicated_items = final
    ctx.total_after_dedup = len(final)

    total_dupes = len(items) - len(final)
    log.info(
        "DeduplicationAgent: %d items → %d unique (merged %d duplicates)",
        len(items), len(final), total_dupes,
    )
    return ctx


# ── Helpers ───────────────────────────────────────────────────────────────────

def _pick_canonical(group: list[RawItem]) -> RawItem:
    """Choose the highest-quality item from a duplicate group as the canonical."""
    if len(group) == 1:
        return group[0]
    # Prefer items with more content, then items with an author
    return max(
        group,
        key=lambda i: (
            len(i.clean_text or ""),
            bool(i.author),
            bool(i.url),
        ),
    )


def _merge_duplicate_sources(canonical: RawItem, group: list[RawItem]) -> None:
    """Attach non-canonical sources as duplicate_sources on the canonical."""
    for item in group:
        if item is canonical:
            continue
        canonical.duplicate_sources.append({
            "source_name": item.source_name,
            "url": item.url,
            "source_type": item.source_type,
        })


def _normalize_url(url: str) -> str:
    """Strip query strings and fragments for URL comparison."""
    url = url.split("?")[0].split("#")[0].rstrip("/").lower()
    # Strip www prefix
    if url.startswith("https://www."):
        url = "https://" + url[12:]
    elif url.startswith("http://www."):
        url = "http://" + url[11:]
    return url


def _semantic_dedup(items: list[RawItem], threshold: float) -> list[RawItem]:
    """
    Greedy semantic deduplication using precomputed embeddings.
    Items without embeddings are always kept as-is.
    O(n²) — acceptable for digest-scale inputs (n < 200).
    """
    with_emb = [(i, np.array(i.embedding)) for i in items if i.embedding]
    without_emb = [i for i in items if not i.embedding]

    if len(with_emb) < 2:
        return items

    kept_indices: list[int] = []
    suppressed: set[int] = set()

    for i, (item_i, emb_i) in enumerate(with_emb):
        if i in suppressed:
            continue
        kept_indices.append(i)
        norm_i = np.linalg.norm(emb_i)
        if norm_i == 0:
            continue
        for j, (item_j, emb_j) in enumerate(with_emb[i + 1:], start=i + 1):
            if j in suppressed:
                continue
            norm_j = np.linalg.norm(emb_j)
            if norm_j == 0:
                continue
            similarity = float(np.dot(emb_i, emb_j) / (norm_i * norm_j))
            if similarity >= threshold:
                # Merge item_j into item_i (item_i was seen first / ranked higher)
                canonical = with_emb[kept_indices[-1]][0]
                _merge_duplicate_sources(canonical, [item_j])
                suppressed.add(j)
                log.debug(
                    "Semantic dedup (sim=%.3f): '%s' merged into '%s'",
                    similarity, item_j.title[:50], canonical.title[:50],
                )

    result = [with_emb[i][0] for i in kept_indices]
    result.extend(without_emb)
    return result
