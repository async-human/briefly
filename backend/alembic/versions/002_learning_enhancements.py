"""Learning enhancements: follow_up_depth, profile_embedding_updated_at, memory/confidence/evolution fields.

Revision ID: 002
Revises: 001
Create Date: 2026-06-02
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── UserProfile: track when profile embedding was last regenerated ─────────
    op.add_column(
        "user_profiles",
        sa.Column("profile_embedding_updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── DigestItem: compounding intelligence fields ────────────────────────────
    op.add_column(
        "digest_items",
        sa.Column("memory_reference", sa.Text(), nullable=True),
    )
    op.add_column(
        "digest_items",
        sa.Column("confidence_signal", sa.Text(), nullable=True),
    )
    op.add_column(
        "digest_items",
        sa.Column("evolution_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "digest_items",
        sa.Column("follow_up_depth", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("digest_items", "follow_up_depth")
    op.drop_column("digest_items", "evolution_note")
    op.drop_column("digest_items", "confidence_signal")
    op.drop_column("digest_items", "memory_reference")
    op.drop_column("user_profiles", "profile_embedding_updated_at")
