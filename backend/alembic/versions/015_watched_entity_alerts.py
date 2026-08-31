"""Watched-entity sources and alerts."""

from alembic import op

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE watched_entities ADD COLUMN IF NOT EXISTS aliases JSONB DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE watched_entities ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 1")
    op.execute("ALTER TABLE watched_entities ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE")
    op.execute("ALTER TABLE watched_entities ADD COLUMN IF NOT EXISTS last_checked TIMESTAMPTZ")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS entity_sources (
          id VARCHAR(36) PRIMARY KEY,
          entity_id VARCHAR(36) NOT NULL REFERENCES watched_entities(id) ON DELETE CASCADE,
          source_type VARCHAR(40) DEFAULT 'news',
          url TEXT NOT NULL,
          last_fetched TIMESTAMPTZ,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_entity_sources_entity ON entity_sources (entity_id)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_source_url
          ON entity_sources (entity_id, url)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS entity_alerts (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entity_id VARCHAR(36) NOT NULL REFERENCES watched_entities(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          summary TEXT DEFAULT '',
          what_changed TEXT DEFAULT '',
          why_it_matters TEXT DEFAULT '',
          action TEXT DEFAULT '',
          source_url TEXT NOT NULL,
          source_name VARCHAR(200) DEFAULT '',
          published_at TIMESTAMPTZ,
          relevance_score DOUBLE PRECISION DEFAULT 0,
          is_read BOOLEAN DEFAULT FALSE,
          is_urgent BOOLEAN DEFAULT FALSE,
          related_urls JSONB DEFAULT '[]'::jsonb,
          sources_checked INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_entity_alerts_user_unread ON entity_alerts (user_id, is_read)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_entity_alerts_entity ON entity_alerts (entity_id)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_alert_source
          ON entity_alerts (entity_id, source_url)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS entity_alerts")
    op.execute("DROP TABLE IF EXISTS entity_sources")
    op.execute("ALTER TABLE watched_entities DROP COLUMN IF EXISTS last_checked")
    op.execute("ALTER TABLE watched_entities DROP COLUMN IF EXISTS is_active")
    op.execute("ALTER TABLE watched_entities DROP COLUMN IF EXISTS priority")
    op.execute("ALTER TABLE watched_entities DROP COLUMN IF EXISTS aliases")
