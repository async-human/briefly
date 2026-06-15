"""Source intelligence: per-source × per-topic engagement weights."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_profiles",
        sa.Column("source_topic_weights", JSONB, nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("user_profiles", "source_topic_weights")
