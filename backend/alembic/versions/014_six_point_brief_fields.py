"""Add the remaining Phase 1 six-point brief fields."""

from alembic import op

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent — ensure_migrations may stamp 014 before this DDL runs, and
    # init_db() also adds these columns on boot.
    op.execute(
        "ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS who_it_affects TEXT"
    )
    op.execute(
        "ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS suggested_action TEXT"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE digest_items DROP COLUMN IF EXISTS suggested_action")
    op.execute("ALTER TABLE digest_items DROP COLUMN IF EXISTS who_it_affects")
