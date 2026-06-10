"""
Shared topic ↔ article text matching.

Uses headline/summary/source plus optional confidence_signal (short attribution).
Never uses why_it_matters — Briefly writes declared interests into that field.
"""
from __future__ import annotations

import math
import re

TOPIC_STOP_WORDS = frozenset({
    "of", "the", "a", "an", "and", "or", "for", "in", "on", "at", "to", "by",
    "with", "from", "as", "is", "it", "be", "are", "was", "were", "its",
})

# Extra tokens to accept for common interest labels
TOPIC_ALIASES: dict[str, list[str]] = {
    "llms": ["llm", "llms", "large language models", "language model", "gpt", "chatgpt"],
    "generative ai": ["generative ai", "gen ai", "genai", "generative", "gpt", "llm", "openai"],
    "ai tools": ["ai tools", "ai tool"],
    "multi-agent systems": ["multi-agent", "multi agent", "agentic"],
    "ai-ml engineer": ["machine learning", "ml engineer", "ai engineer"],
    "startup funding": ["funding round", "raised", "series a", "venture"],
    "product-market fit": ["product market fit", "pmf"],
    "bill of materials": ["bill of materials", "bom"],
}


def topic_keywords(topic: str) -> set[str]:
    """Significant tokens from a topic label (stop words excluded)."""
    return set(significant_words(topic))


def significant_words(topic: str) -> list[str]:
    normalized = topic.strip().lower().replace("-", " ").replace("/", " ")
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


def _topic_matches_core(text: str, topic: str) -> bool:
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


def topic_matches(text: str, topic: str) -> bool:
    """True when article text is genuinely about a topic."""
    if _topic_matches_core(text, topic):
        return True
    topic_key = topic.strip().lower()
    for alias in TOPIC_ALIASES.get(topic_key, []):
        if _topic_matches_core(text, alias):
            return True
    return False


def item_matches_topic(
    headline: str | None,
    summary: str | None,
    source_name: str | None,
    confidence_signal: str | None,
    topic: str,
) -> bool:
    """
    Whether a briefing item is about a topic.

    Uses article text first; confidence_signal only when it names the topic
    (short phrase, not the long why_it_matters paragraph).
    """
    body = topic_match_text(headline, summary, source_name)
    if topic_matches(body, topic):
        return True

    cs = (confidence_signal or "").strip()
    if not cs or len(cs) > 120:
        return False

    topic_l = topic.strip().lower()
    cs_l = cs.lower()
    if topic_l in cs_l:
        return True

    for alias in TOPIC_ALIASES.get(topic_l, []):
        if alias in cs_l:
            return True

    return topic_matches(cs, topic)


def topic_match_score_partial(text: str, topic: str) -> float:
    """Share of significant topic words found in text (0–1), no threshold."""
    if not text or not topic:
        return 0.0
    hay = text.lower()
    topic_clean = topic.strip().lower()
    if topic_clean in hay:
        return 1.0
    sig = significant_words(topic)
    if not sig:
        return 0.0
    hits = sum(1 for w in sig if _word_in_text(w, hay))
    score = hits / len(sig)
    topic_key = topic.strip().lower()
    for alias in TOPIC_ALIASES.get(topic_key, []):
        if _word_in_text(alias, hay) or alias in hay:
            score = max(score, 0.5 if len(sig) >= 2 else 1.0)
    return score


def topic_match_score(text: str, topic: str) -> float:
    """0–1 overlap score for ranking (e.g. knowledge graph)."""
    if topic_matches(text, topic):
        return topic_match_score_partial(text, topic)
    return 0.0


def topics_for_digest_item(
    headline: str | None,
    summary: str | None,
    source_name: str | None,
    confidence_signal: str | None,
    declared_topics: list[str],
) -> list[str]:
    """
    Topics a briefing item belongs to.

    Strict phrase/word rules first; otherwise the single best partial match
  (≥50% of significant words) so each story counts toward one topic at most.
    """
    strict = [
        t
        for t in declared_topics
        if item_matches_topic(headline, summary, source_name, confidence_signal, t)
    ]
    if strict:
        return strict

    body = topic_match_text(headline, summary, source_name)
    cs = (confidence_signal or "").strip()
    best_topic: str | None = None
    best_score = 0.0
    for topic in declared_topics:
        score = topic_match_score_partial(body, topic)
        if cs and len(cs) <= 120:
            score = max(score, topic_match_score_partial(cs, topic))
        if score > best_score:
            best_score = score
            best_topic = topic

    if best_topic and best_score >= 0.5:
        return [best_topic]
    return []
