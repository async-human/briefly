"""Billing events — subscription lifecycle and churn feedback."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "billing_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("reason", sa.String(64), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("meta", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_billing_events_user_id", "billing_events", ["user_id"])
    op.create_index("ix_billing_events_user_created", "billing_events", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_billing_events_user_created", table_name="billing_events")
    op.drop_index("ix_billing_events_user_id", table_name="billing_events")
    op.drop_table("billing_events")
