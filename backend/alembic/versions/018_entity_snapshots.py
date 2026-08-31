"""Versioned entity snapshots for last-known pricing / API / product state."""

from alembic import op

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS entity_snapshots (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entity_id VARCHAR(36) NOT NULL REFERENCES watched_entities(id) ON DELETE CASCADE,
          aspect VARCHAR(40) NOT NULL,
          state_text TEXT NOT NULL,
          source_url TEXT DEFAULT '',
          signal_id VARCHAR(36) REFERENCES signals(id) ON DELETE SET NULL,
          observed_at TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_entity_snapshots_latest
          ON entity_snapshots (user_id, entity_id, aspect, observed_at)
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_entity_snapshots_entity ON entity_snapshots (entity_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS entity_snapshots")
