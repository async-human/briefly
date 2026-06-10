"""Add contradiction fields to digest_items.

Revision ID: 004
Revises: 003
Create Date: 2026-06-10
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "digest_items",
        sa.Column("contradiction_flag", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "digest_items",
        sa.Column("contradiction_explanation", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("digest_items", "contradiction_explanation")
    op.drop_column("digest_items", "contradiction_flag")
