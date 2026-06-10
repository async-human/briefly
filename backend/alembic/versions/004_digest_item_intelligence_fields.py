"""Add contradiction fields to digest_items.

Revision ID: 004
Revises: 003
Create Date: 2026-06-10
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent — init_db() may have already added these columns on legacy deploys.
    op.execute(
        """
        ALTER TABLE digest_items
        ADD COLUMN IF NOT EXISTS contradiction_flag BOOLEAN NOT NULL DEFAULT FALSE
        """
    )
    op.execute(
        """
        ALTER TABLE digest_items
        ADD COLUMN IF NOT EXISTS contradiction_explanation TEXT
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE digest_items DROP COLUMN IF EXISTS contradiction_explanation")
    op.execute("ALTER TABLE digest_items DROP COLUMN IF EXISTS contradiction_flag")
