"""Human-readable 'Briefly learned' messages after user feedback."""
from __future__ import annotations


def build_learned_message(signal_type: str, *, source_name: str | None, headline: str) -> str | None:
    source = (source_name or "this source").strip()
    topic_hint = _topic_from_headline(headline)

    if signal_type in ("saved", "liked", "remembered"):
        if topic_hint:
            return f"Got it — more like {topic_hint} in tomorrow's brief."
        if signal_type == "remembered":
            return "Saved to your market memory."
        return f"Noted — {source} is a priority for you now."

    if signal_type == "disliked":
        if topic_hint:
            return f"Understood — less {topic_hint} coverage going forward."
        return f"Got it — less from {source}."

    if signal_type == "skipped":
        return "Noted — similar stories will rank lower."

    if signal_type in ("followed_up", "asked", "ask"):
        return "Noted — I'll use this question to sharpen tomorrow's brief."
    if signal_type in ("tracked", "track"):
        return "Tracking that. I'll surface material changes, not every mention."
    if signal_type in ("acted", "act"):
        return "Logged as an action. I'll look for follow-up evidence."
    if signal_type in ("decision_changed", "changed_my_decision"):
        return "Recorded. I'll treat this as a decision that new evidence can reopen."
    if signal_type in ("dismissed", "dismiss", "irrelevant"):
        return "Dismissed — similar signals will rank lower."
    if signal_type in ("useful",):
        return "Marked useful. I'll use this as a positive example for ranking."
    if signal_type in ("duplicate",):
        return "Marked duplicate. I'll collapse similar coverage next time."
    if signal_type in ("incorrect", "wrong"):
        return "Thanks — I'll treat that extraction as a miss."
    if signal_type in ("acted_on",):
        return "Logged as an action. I'll look for follow-up evidence."

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
