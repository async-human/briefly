"""Background jobs table + HNSW index on content embeddings.

Revision ID: 005
Revises: 004
Create Date: 2026-06-10
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS background_jobs (
            id VARCHAR(36) PRIMARY KEY,
            job_type VARCHAR(64) NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 5,
            idempotency_key VARCHAR(128),
            run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            locked_at TIMESTAMPTZ,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_background_jobs_status_run_after "
        "ON background_jobs (status, run_after)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_background_jobs_idempotency
        ON background_jobs (job_type, idempotency_key)
        WHERE idempotency_key IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_content_embeddings_hnsw
        ON content_embeddings
        USING hnsw (embedding vector_cosine_ops)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_content_embeddings_hnsw")
    op.execute("DROP INDEX IF EXISTS uq_background_jobs_idempotency")
    op.execute("DROP INDEX IF EXISTS ix_background_jobs_status_run_after")
    op.execute("DROP TABLE IF EXISTS background_jobs")
