"""Startup checks for embedding dimension consistency."""
from __future__ import annotations

import logging

from briefly_api.config import get_settings

log = logging.getLogger(__name__)

# Must match Vector(N) on content_embeddings.profile_embedding columns (migration 001).
PINNED_PGVECTOR_DIM = 1024


def validate_embedding_configuration() -> None:
    settings = get_settings()
    if settings.embedding_dim != PINNED_PGVECTOR_DIM:
        log.warning(
            "EMBEDDING_DIM=%s but pgvector columns are pinned to %s. "
            "Changing dimensions requires a migration and full re-embed of all content.",
            settings.embedding_dim,
            PINNED_PGVECTOR_DIM,
        )
    if settings.embedding_provider == "openai" and settings.embedding_dim != PINNED_PGVECTOR_DIM:
        log.warning(
            "OpenAI embeddings use dimensions=%s via API; DB columns remain %s until migrated.",
            settings.embedding_dim,
            PINNED_PGVECTOR_DIM,
        )
