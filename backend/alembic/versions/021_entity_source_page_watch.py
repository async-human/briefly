"""Pinned official page hashes on watched-entity sources."""

from alembic import op


revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE entity_sources ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)"
    )
    op.execute("ALTER TABLE entity_sources ADD COLUMN IF NOT EXISTS last_extract TEXT")
    op.execute("ALTER TABLE entity_sources ADD COLUMN IF NOT EXISTS last_error TEXT")
    op.execute(
        "ALTER TABLE entity_sources ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE entity_sources DROP COLUMN IF EXISTS consecutive_failures")
    op.execute("ALTER TABLE entity_sources DROP COLUMN IF EXISTS last_error")
    op.execute("ALTER TABLE entity_sources DROP COLUMN IF EXISTS last_extract")
    op.execute("ALTER TABLE entity_sources DROP COLUMN IF EXISTS content_hash")
