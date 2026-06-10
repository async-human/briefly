"""Helpers for pgvector / numpy profile embeddings stored on UserProfile."""
from __future__ import annotations

from typing import Any


def embedding_as_list(value: Any) -> list[float] | None:
    """Safe conversion — never use ``if embedding`` on numpy arrays."""
    if value is None:
        return None
    try:
        import numpy as np

        if isinstance(value, np.ndarray):
            return value.tolist() if value.size else None
    except ImportError:
        pass
    if isinstance(value, (list, tuple)):
        return list(value) if value else None
    return list(value)
