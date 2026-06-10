"""Add weekly_snapshot JSONB to behavioral_fingerprints."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "behavioral_fingerprints",
        sa.Column("weekly_snapshot", JSONB, nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("behavioral_fingerprints", "weekly_snapshot")
