"""Operating context, decision-loop events, and market signals."""

from alembic import op

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS operating_context JSONB DEFAULT '{}'::jsonb"
    )
    op.execute(
        """
        ALTER TABLE watched_entities
          ADD COLUMN IF NOT EXISTS relationship_to_user VARCHAR(40) DEFAULT 'watch'
        """
    )
    op.execute("ALTER TABLE watched_entities ADD COLUMN IF NOT EXISTS watch_reason TEXT")
    op.execute(
        "ALTER TABLE watched_entities ADD COLUMN IF NOT EXISTS monitoring_rules JSONB DEFAULT '{}'::jsonb"
    )
    op.execute(
        "ALTER TABLE entity_alerts ADD COLUMN IF NOT EXISTS detector_type VARCHAR(40)"
    )
    op.execute(
        "ALTER TABLE entity_alerts ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION DEFAULT 0"
    )

    # Behavioral signals: native enum → varchar so new labels do not need ALTER TYPE.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'behavioral_signals'
                  AND column_name = 'signal_type'
                  AND udt_name = 'signaltype'
            ) THEN
                ALTER TABLE behavioral_signals
                    ALTER COLUMN signal_type TYPE VARCHAR(50)
                    USING signal_type::text;
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS signals (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entity_id VARCHAR(36) REFERENCES watched_entities(id) ON DELETE SET NULL,
          detector_type VARCHAR(40) NOT NULL,
          title TEXT NOT NULL,
          what_changed TEXT DEFAULT '',
          previous_state TEXT DEFAULT '',
          new_state TEXT DEFAULT '',
          confidence DOUBLE PRECISION DEFAULT 0,
          status VARCHAR(20) DEFAULT 'candidate',
          source_url TEXT NOT NULL,
          content_id VARCHAR(36),
          digest_item_id VARCHAR(36),
          alert_id VARCHAR(36),
          detected_at TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_signals_user_detected ON signals (user_id, detected_at)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_signals_entity ON signals (entity_id)")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_source
          ON signals (user_id, entity_id, source_url)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS signal_evidence (
          id VARCHAR(36) PRIMARY KEY,
          signal_id VARCHAR(36) NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
          source_url TEXT NOT NULL,
          source_name VARCHAR(200) DEFAULT '',
          extracted_claim TEXT DEFAULT '',
          supporting_passage TEXT DEFAULT '',
          published_at TIMESTAMPTZ,
          is_contradictory BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_signal_evidence_signal ON signal_evidence (signal_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS signal_impacts (
          id VARCHAR(36) PRIMARY KEY,
          signal_id VARCHAR(36) NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
          user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          why_it_matters TEXT DEFAULT '',
          who_affected TEXT DEFAULT '',
          recommended_action TEXT DEFAULT '',
          strategic_questions_hit JSONB DEFAULT '[]'::jsonb,
          confidence DOUBLE PRECISION DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_signal_impacts_signal ON signal_impacts (signal_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_signal_impacts_user ON signal_impacts (user_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS signal_feedback (
          id VARCHAR(36) PRIMARY KEY,
          signal_id VARCHAR(36) NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
          user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          label VARCHAR(40) NOT NULL,
          note TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_signal_feedback_signal ON signal_feedback (signal_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_signal_feedback_user ON signal_feedback (user_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS signal_feedback")
    op.execute("DROP TABLE IF EXISTS signal_impacts")
    op.execute("DROP TABLE IF EXISTS signal_evidence")
    op.execute("DROP TABLE IF EXISTS signals")
    op.execute("ALTER TABLE entity_alerts DROP COLUMN IF EXISTS confidence")
    op.execute("ALTER TABLE entity_alerts DROP COLUMN IF EXISTS detector_type")
    op.execute("ALTER TABLE watched_entities DROP COLUMN IF EXISTS monitoring_rules")
    op.execute("ALTER TABLE watched_entities DROP COLUMN IF EXISTS watch_reason")
    op.execute("ALTER TABLE watched_entities DROP COLUMN IF EXISTS relationship_to_user")
    op.execute("ALTER TABLE user_profiles DROP COLUMN IF EXISTS operating_context")
