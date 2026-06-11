"""Phase 1: score_breakdown, brief style/language, profile_meta for learned adjustments."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "digest_items",
        sa.Column("score_breakdown", JSONB, nullable=False, server_default="{}"),
    )
    op.add_column(
        "user_profiles",
        sa.Column("brief_style", sa.String(32), nullable=False, server_default="analyst"),
    )
    op.add_column(
        "user_profiles",
        sa.Column("brief_language", sa.String(8), nullable=False, server_default="en"),
    )
    op.add_column(
        "user_profiles",
        sa.Column("profile_meta", JSONB, nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("user_profiles", "profile_meta")
    op.drop_column("user_profiles", "brief_language")
    op.drop_column("user_profiles", "brief_style")
    op.drop_column("digest_items", "score_breakdown")
