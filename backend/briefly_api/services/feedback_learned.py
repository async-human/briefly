"""Human-readable 'Briefly learned' messages after user feedback."""
from __future__ import annotations


def build_learned_message(signal_type: str, *, source_name: str | None, headline: str) -> str | None:
    source = (source_name or "this source").strip()
    topic_hint = _topic_from_headline(headline)

    if signal_type in ("saved", "liked"):
        if topic_hint:
            return f"Got it — more like {topic_hint} in tomorrow's brief."
        return f"Noted — {source} is a priority for you now."

    if signal_type == "disliked":
        if topic_hint:
            return f"Understood — less {topic_hint} coverage going forward."
        return f"Got it — less from {source}."

    if signal_type == "skipped":
        return "Noted — similar stories will rank lower."

    if signal_type == "clicked":
        return None

    return None


def _topic_from_headline(headline: str) -> str | None:
    text = (headline or "").strip()
    if not text or len(text) < 8:
        return None
    # Use first clause as a lightweight topic hint
    clause = text.split("—")[0].split(":")[0].strip()
    if len(clause) > 60:
        clause = " ".join(clause.split()[:6])
    return clause.lower() if clause else None
