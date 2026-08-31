"""Add the remaining Phase 1 six-point brief fields."""

from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("digest_items", sa.Column("who_it_affects", sa.Text(), nullable=True))
    op.add_column("digest_items", sa.Column("suggested_action", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("digest_items", "suggested_action")
    op.drop_column("digest_items", "who_it_affects")
