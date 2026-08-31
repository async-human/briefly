"""Evidence bundles for the six-point decision brief.

A bundle is the Sprint 3 object: source, claim, passage, previous vs new
state, confidence, corroborating sources, and contradictory evidence.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from briefly_api.services.digest_sections import SECTION_WHATS_NEW
from briefly_api.services.operating_context import who_affected_from_context
from briefly_api.services.watch.relevance import canonicalize_url

POSITIVE_LABELS = frozenset({"useful", "acted_on"})
NEGATIVE_LABELS = frozenset({"irrelevant", "duplicate", "incorrect"})
FEEDBACK_LABELS = frozenset({*POSITIVE_LABELS, *NEGATIVE_LABELS})
_BEHAVIORAL_TO_LABEL = {
    "acted": "acted_on",
    "act": "acted_on",
    "dismissed": "irrelevant",
    "dismiss": "irrelevant",
    "decision_changed": "useful",
    "changed_my_decision": "useful",
}


def normalize_label(raw: str | None) -> str | None:
    value = (raw or "").strip().lower()
    if value in FEEDBACK_LABELS:
        return value
    return _BEHAVIORAL_TO_LABEL.get(value)


def url_key(url: str | None) -> str:
    raw = canonicalize_url(url or "")
    return raw.lower() if raw else ""


def evidence_piece(
    *,
    source_url: str,
    source_name: str = "",
    extracted_claim: str = "",
    supporting_passage: str = "",
    published_at: datetime | None = None,
    is_contradictory: bool = False,
) -> dict[str, Any]:
    published = None
    if published_at is not None:
        published = published_at.isoformat() if hasattr(published_at, "isoformat") else str(published_at)
    return {
        "source_url": source_url,
        "source_name": source_name or "",
        "extracted_claim": (extracted_claim or "")[:500],
        "supporting_passage": (supporting_passage or "")[:800],
        "published_at": published,
        "is_contradictory": bool(is_contradictory),
    }


def bundle_from_signal(
    *,
    signal_id: str,
    detector_type: str | None,
    confidence: float,
    previous_state: str = "",
    new_state: str = "",
    pieces: list[dict[str, Any]],
    label: str | None = None,
) -> dict[str, Any]:
    primary = next((p for p in pieces if not p.get("is_contradictory")), None)
    corroborating = [
        p for p in pieces
        if not p.get("is_contradictory") and p is not primary
    ]
    contradictory = [p for p in pieces if p.get("is_contradictory")]
    return {
        "signal_id": signal_id,
        "detector_type": detector_type or None,
        "confidence": round(float(confidence or 0), 3),
        "previous_state": (previous_state or "")[:500],
        "new_state": (new_state or "")[:500],
        "extracted_claim": (primary or {}).get("extracted_claim") or (new_state or ""),
        "supporting_passage": (primary or {}).get("supporting_passage") or "",
        "corroborating_count": len(corroborating),
        "label": label,
        "pieces": pieces,
        "contradictory": contradictory,
    }


def bundle_from_item(item: Any) -> dict[str, Any]:
    """Citation-backed bundle when no market signal is linked yet."""
    source_url = getattr(item, "source_url", None) or ""
    source_name = getattr(item, "source_name", None) or ""
    headline = getattr(item, "headline", "") or ""
    summary = getattr(item, "summary", "") or ""
    pieces: list[dict[str, Any]] = []
    if source_url:
        pieces.append(
            evidence_piece(
                source_url=source_url,
                source_name=source_name,
                extracted_claim=headline[:500],
                supporting_passage=summary[:800],
            )
        )
    extras = getattr(item, "all_sources", None) or []
    seen = {url_key(source_url)}
    for extra in extras:
        if not isinstance(extra, dict):
            continue
        url = extra.get("url") or extra.get("source_url") or ""
        key = url_key(url)
        if not key or key in seen:
            continue
        seen.add(key)
        pieces.append(
            evidence_piece(
                source_url=url,
                source_name=str(extra.get("name") or extra.get("source_name") or ""),
                extracted_claim=headline[:500],
            )
        )
    explanation = getattr(item, "contradiction_explanation", None) or ""
    if getattr(item, "contradiction_flag", False) and explanation:
        pieces.append(
            evidence_piece(
                source_url=source_url or "memory",
                source_name="Earlier brief",
                extracted_claim=explanation[:500],
                supporting_passage=explanation[:800],
                is_contradictory=True,
            )
        )
    confidence = getattr(item, "relevance_score", None)
    return {
        "signal_id": None,
        "detector_type": None,
        "confidence": round(float(confidence or 0), 3),
        "previous_state": "",
        "new_state": headline[:500],
        "extracted_claim": headline[:500],
        "supporting_passage": summary[:800],
        "corroborating_count": max(0, len(pieces) - 1 - int(bool(explanation and getattr(item, "contradiction_flag", False)))),
        "label": None,
        "pieces": pieces,
        "contradictory": [p for p in pieces if p.get("is_contradictory")],
    }


def precision_from_labels(labels: list[str]) -> dict[str, Any]:
    """Baseline precision: useful / (useful + not-useful) among labeled signals."""
    useful = sum(1 for label in labels if label in POSITIVE_LABELS)
    not_useful = sum(1 for label in labels if label in NEGATIVE_LABELS)
    labeled = useful + not_useful
    by_label: dict[str, int] = {}
    for label in labels:
        if label in FEEDBACK_LABELS:
            by_label[label] = by_label.get(label, 0) + 1
    return {
        "labeled": labeled,
        "useful": useful,
        "not_useful": not_useful,
        "precision": round(useful / labeled, 3) if labeled else None,
        "by_label": by_label,
    }


_DETECTOR_CONFIDENCE = {
    "pricing_positioning": "Pricing or positioning change on something you watch.",
    "model_api": "Model or API change on something you watch.",
    "product_release": "Product release or changelog on something you watch.",
}


def watching_alert_item_kwargs(alert: dict[str, Any], profile: dict[str, Any] | None) -> dict[str, Any]:
    """Fields for a DigestItem pinned from a watching alert."""
    detector = alert.get("detector_type") or ""
    confidence = float(alert.get("confidence") or 0)
    who = who_affected_from_context((profile or {}).get("operating_context"))
    action = (alert.get("action") or "").strip()
    if action.lower().startswith("none"):
        action = ""
    related = [u for u in (alert.get("related_urls") or []) if isinstance(u, str) and u]
    extras = [{"name": "", "url": u} for u in related[:6]]
    return {
        "content_id": None,
        "section": SECTION_WHATS_NEW,
        "headline": (alert.get("title") or "")[:500],
        "summary": (alert.get("what_changed") or alert.get("title") or "")[:800],
        "why_it_matters": (alert.get("why_it_matters") or "")[:800],
        "who_it_affects": who or None,
        "suggested_action": action[:400] or None,
        "source_name": alert.get("source_name") or alert.get("entity_name"),
        "source_url": alert.get("source_url"),
        "all_sources": extras,
        "duplicate_count": 1 + len(extras),
        "memory_connections": [],
        "relevance_score": float(alert.get("confidence") or 0) or None,
        "novelty_score": None,
        "memory_reference": None,
        "confidence_signal": _DETECTOR_CONFIDENCE.get(detector) if detector in _DETECTOR_CONFIDENCE else (
            f"{int(confidence * 100)}% match to a watched change." if confidence else None
        ),
        "evolution_note": None,
        "contradiction_flag": False,
        "contradiction_explanation": None,
        "score_breakdown": {
            "detector_type": detector,
            "watch_alert_id": alert.get("id"),
        },
    }
