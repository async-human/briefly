"""Temporal market-signal layer: typed detectors, evidence, impact."""

from briefly_api.services.signals.detectors import (
    DETECTOR_TYPES,
    DetectorResult,
    classify_change,
)
from briefly_api.services.signals.evidence import (
    FEEDBACK_LABELS,
    bundle_from_item,
    bundle_from_signal,
    normalize_label,
    precision_from_labels,
)

__all__ = [
    "DETECTOR_TYPES",
    "DetectorResult",
    "FEEDBACK_LABELS",
    "bundle_from_item",
    "bundle_from_signal",
    "classify_change",
    "precision_from_labels",
]
