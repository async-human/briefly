"""
Shared topic ↔ article text matching.

Uses headline/summary/source only — never why_it_matters, which is written by
Briefly and name-drops the user's declared interests (circular false positives).
"""
from __future__ import annotations

import math
import re

TOPIC_STOP_WORDS = frozenset({
    "of", "the", "a", "an", "and", "or", "for", "in", "on", "at", "to", "by",
    "with", "from", "as", "is", "it", "be", "are", "was", "were", "its",
})


def topic_keywords(topic: str) -> set[str]:
    """Significant tokens from a topic label (stop words excluded)."""
    return set(significant_words(topic))


def significant_words(topic: str) -> list[str]:
    normalized = topic.strip().lower().replace("-", " ")
    words: list[str] = []
    for word in normalized.split():
        cleaned = word.strip(".,;:!?\"'()[]")
        if len(cleaned) >= 2 and cleaned not in TOPIC_STOP_WORDS:
            words.append(cleaned)
    return words


def topic_match_text(*parts: str | None) -> str:
    """Join article fields safe for topic matching."""
    return " ".join(filter(None, parts)).lower()


def _word_in_text(word: str, text: str) -> bool:
    """Short tokens use word boundaries to avoid substring noise."""
    if len(word) <= 3:
        return bool(re.search(rf"\b{re.escape(word)}\b", text, re.I))
    return word.lower() in text.lower()


def topic_matches(text: str, topic: str) -> bool:
    """
    True when article text is genuinely about a topic.

    - Full phrase match wins
    - Multi-word topics need most significant words (not any single token)
    - Stop words like "of" never count alone
    """
    if not text or not topic:
        return False

    hay = text.lower()
    topic_clean = topic.strip().lower()

    if topic_clean in hay:
        return True

    sig = significant_words(topic)
    if not sig:
        return False

    if len(sig) == 1:
        return _word_in_text(sig[0], hay)

    hits = sum(1 for w in sig if _word_in_text(w, hay))
    required = len(sig) if len(sig) <= 2 else max(2, math.ceil(len(sig) * 0.6))
    return hits >= required


def topic_match_score(text: str, topic: str) -> float:
    """0–1 overlap score for ranking (e.g. knowledge graph)."""
    if not text or not topic:
        return 0.0
    if topic_matches(text, topic):
        sig = significant_words(topic)
        if not sig:
            return 1.0 if topic.strip().lower() in text.lower() else 0.0
        hits = sum(1 for w in sig if _word_in_text(w, text.lower()))
        return hits / len(sig)
    return 0.0
