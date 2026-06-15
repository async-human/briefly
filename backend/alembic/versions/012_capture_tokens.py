"""Capture device tokens — long-lived, revocable, capture-scoped per device."""

from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "capture_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("token_prefix", sa.String(16), nullable=False),
        sa.Column("platform", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_capture_tokens_user_id", "capture_tokens", ["user_id"])
    op.create_unique_constraint("uq_capture_token_hash", "capture_tokens", ["token_hash"])
    op.create_index("ix_capture_tokens_token_hash", "capture_tokens", ["token_hash"])


def downgrade() -> None:
    op.drop_index("ix_capture_tokens_token_hash", table_name="capture_tokens")
    op.drop_constraint("uq_capture_token_hash", "capture_tokens", type_="unique")
    op.drop_index("ix_capture_tokens_user_id", table_name="capture_tokens")
    op.drop_table("capture_tokens")
