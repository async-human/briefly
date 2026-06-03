"""Add subscription fields to users table.

Revision ID: 003
Revises: 002
Create Date: 2026-06-03
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("plan", sa.String(20), nullable=False, server_default="free"))
    op.add_column("users", sa.Column("is_founding_member", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("users", sa.Column("ls_customer_id", sa.String(50), nullable=True))
    op.add_column("users", sa.Column("ls_subscription_id", sa.String(50), nullable=True))
    op.add_column("users", sa.Column("subscribed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_ls_customer_id", "users", ["ls_customer_id"])


def downgrade() -> None:
    op.drop_index("ix_users_ls_customer_id", table_name="users")
    op.drop_column("users", "subscribed_at")
    op.drop_column("users", "ls_subscription_id")
    op.drop_column("users", "ls_customer_id")
    op.drop_column("users", "is_founding_member")
    op.drop_column("users", "plan")
