"""Production hardening: activity events, digest failures, indexes.

Revision ID: 001
Revises:
Create Date: 2026-06-02
"""
from __future__ import annotations

import json
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_activity_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_activity_events_user_id", "user_activity_events", ["user_id"])
    op.create_index("ix_user_activity_user_created", "user_activity_events", ["user_id", "created_at"])

    op.create_table(
        "digest_failures",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("digest_date", sa.String(length=10), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=False),
        sa.Column("retry_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("max_retries", sa.Integer(), server_default="1", nullable=False),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_digest_failures_user_id", "digest_failures", ["user_id"])
    op.create_index("ix_digest_failures_pending", "digest_failures", ["resolved_at", "next_retry_at"])

    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS ix_user_memory_user_type "
            "ON user_memory (user_id, memory_type)"
        )
    )
    op.execute(
        sa.text(
            "CREATE INDEX IF NOT EXISTS ix_behavioral_signals_user_created "
            "ON behavioral_signals (user_id, created_at)"
        )
    )

    conn = op.get_bind()
    profiles = conn.execute(
        sa.text(
            "SELECT user_id, activity_feed FROM user_profiles "
            "WHERE activity_feed IS NOT NULL AND jsonb_array_length(activity_feed) > 0"
        )
    ).fetchall()

    for user_id, feed in profiles:
        if not feed:
            continue
        for elem in reversed(feed):
            if not isinstance(elem, dict):
                continue
            event_id = str(uuid.uuid4())
            event_type = elem.get("type") or "event"
            message = elem.get("message") or ""
            at = elem.get("at")
            meta = {k: v for k, v in elem.items() if k not in {"type", "message", "at"}}
            conn.execute(
                sa.text(
                    """
                    INSERT INTO user_activity_events (id, user_id, event_type, message, meta, created_at)
                    VALUES (:id, :user_id, :event_type, :message, CAST(:meta AS jsonb), COALESCE(CAST(:at AS timestamptz), NOW()))
                    """
                ),
                {
                    "id": event_id,
                    "user_id": user_id,
                    "event_type": event_type,
                    "message": message,
                    "meta": json.dumps(meta),
                    "at": at,
                },
            )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_behavioral_signals_user_created"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_user_memory_user_type"))
    op.drop_index("ix_digest_failures_pending", table_name="digest_failures")
    op.drop_index("ix_digest_failures_user_id", table_name="digest_failures")
    op.drop_table("digest_failures")
    op.drop_index("ix_user_activity_user_created", table_name="user_activity_events")
    op.drop_index("ix_user_activity_events_user_id", table_name="user_activity_events")
    op.drop_table("user_activity_events")
