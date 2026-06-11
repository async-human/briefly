"""Add content_id to follow_up_threads for Ask Briefly article scope."""

from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "follow_up_threads",
        sa.Column("content_id", sa.String(36), nullable=True),
    )
    op.create_index(
        "ix_follow_up_threads_content_id",
        "follow_up_threads",
        ["content_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_follow_up_threads_content_id", table_name="follow_up_threads")
    op.drop_column("follow_up_threads", "content_id")
