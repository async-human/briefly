"""First three change detectors for AI/software founders.

Typed, rule-based classification of a watched-entity hit. LLM copy still
writes the brief; these detectors decide *what kind of change* it is so
signals are reviewable and evaluable.

Do not add a fourth detector until these three meet precision targets.
"""
from __future__ import annotations

from dataclasses import dataclass

DETECTOR_PRICING = "pricing_positioning"
DETECTOR_MODEL_API = "model_api"
DETECTOR_PRODUCT = "product_release"
DETECTOR_OTHER = "other"

DETECTOR_TYPES = (DETECTOR_PRICING, DETECTOR_MODEL_API, DETECTOR_PRODUCT)

_PRICING = (
    "pricing", "price drop", "price cut", "price increase", "price change",
    "priced", "cheaper", "discount", "packaging", "repackag", "plan tier",
    "new plan", "free tier", "pro plan", "enterprise plan", "per seat",
    "per-token", "per token", "billing", "list price", "sku", "upmarket",
    "downmarket", "reposition", "positioning", "rebrand", "tagline",
    "now called", "go-to-market", "gtm", "packaging change",
)
_MODEL_API = (
    "api deprecat", "deprecat", "api launch", "api release", "api pricing",
    "new model", "model launch", "model release", "foundation model",
    "context window", "rate limit", "endpoint", "sdk", "breaking change",
    "gpt-", "gpt4", "gpt-4", "gpt-5", "claude", "gemini", "llama",
    "mistral", "groq", "openai api", "anthropic api", "available via api",
    "tokens", "inference", "weights", "open weights", "model card",
)
_PRODUCT = (
    "changelog", "release notes", "what's new", "whats new",
    "product launch", "launched", "launches", "shipping", "shipped",
    "generally available", " ga ", "public beta", "open beta",
    "new feature", "product update", "version ", " v1", " v2", " v3",
    "ga release", "now available", "introducing",
)


@dataclass(frozen=True)
class DetectorResult:
    detector_type: str
    confidence: float
    previous_state: str
    new_state: str
    extracted_claim: str
    supporting_passage: str


def _hits(blob: str, needles: tuple[str, ...]) -> list[str]:
    return [n for n in needles if n in blob]


def _passage(summary: str, title: str) -> str:
    text = (summary or "").strip() or (title or "").strip()
    return text[:400]


_PAGE_FORCE = {
    "pricing": DETECTOR_PRICING,
    "docs": DETECTOR_MODEL_API,
    "changelog": DETECTOR_PRODUCT,
}


def classify_change(
    *,
    title: str,
    summary: str = "",
    source_type: str = "",
    entity_name: str = "",
    entity_kind: str = "",
    previous_state: str = "",
) -> DetectorResult:
    forced = _PAGE_FORCE.get(source_type)
    if forced:
        confidence = 0.9
        if entity_kind in ("company", "product") and entity_name:
            confidence = 0.95
        claim = (summary or title or "").strip().split("\n", 1)[0][:240] or (title or "").strip()[:240]
        new_state = (summary or "").strip()[:240] or claim
        return DetectorResult(
            detector_type=forced,
            confidence=confidence,
            previous_state=(previous_state or "")[:240],
            new_state=new_state,
            extracted_claim=claim,
            supporting_passage=_passage(summary, title),
        )

    blob = f"{title} {summary}".lower()
    pricing = _hits(blob, _PRICING)
    model = _hits(blob, _MODEL_API)
    product = _hits(blob, _PRODUCT)
    if source_type in ("github", "changelog") and not product:
        product = ["changelog"]

    scored = [
        (DETECTOR_PRICING, pricing, 0.22),
        (DETECTOR_MODEL_API, model, 0.2),
        (DETECTOR_PRODUCT, product, 0.18),
    ]
    scored.sort(key=lambda row: (len(row[1]), row[2]), reverse=True)
    best_type, matches, base = scored[0]
    if not matches:
        return DetectorResult(
            detector_type=DETECTOR_OTHER,
            confidence=0.25,
            previous_state=(previous_state or "")[:240],
            new_state=(title or "").strip()[:240],
            extracted_claim=(title or "").strip()[:240],
            supporting_passage=_passage(summary, title),
        )

    confidence = min(0.92, base + 0.18 * len(matches))
    if entity_kind in ("company", "product") and entity_name:
        confidence = min(0.95, confidence + 0.05)
    claim = (title or "").strip()[:240]
    return DetectorResult(
        detector_type=best_type,
        confidence=round(confidence, 3),
        previous_state=(previous_state or "")[:240],
        new_state=claim,
        extracted_claim=claim,
        supporting_passage=_passage(summary, title),
    )
