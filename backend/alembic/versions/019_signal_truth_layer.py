"""Harden signal identity, materiality, and structured entity state."""

from alembic import op


revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE entity_alerts ADD COLUMN IF NOT EXISTS event_fingerprint VARCHAR(64)")
    op.execute("ALTER TABLE entity_alerts DROP CONSTRAINT IF EXISTS uq_entity_alert_source")
    op.execute("DROP INDEX IF EXISTS uq_entity_alert_source")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_alert_event
          ON entity_alerts (entity_id, event_fingerprint)
          WHERE event_fingerprint IS NOT NULL
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_entity_alerts_source_url ON entity_alerts (source_url)")

    op.execute("ALTER TABLE signals ADD COLUMN IF NOT EXISTS event_fingerprint VARCHAR(64)")
    op.execute(
        "ALTER TABLE signals ADD COLUMN IF NOT EXISTS is_material_change BOOLEAN DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE signals ADD COLUMN IF NOT EXISTS is_state_change BOOLEAN DEFAULT FALSE"
    )
    op.execute("ALTER TABLE signals DROP CONSTRAINT IF EXISTS uq_signal_source")
    op.execute("DROP INDEX IF EXISTS uq_signal_source")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_event
          ON signals (user_id, entity_id, event_fingerprint)
          WHERE event_fingerprint IS NOT NULL
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_signals_source_url ON signals (source_url)")

    op.execute("ALTER TABLE entity_snapshots ADD COLUMN IF NOT EXISTS state_value TEXT")
    op.execute("ALTER TABLE entity_snapshots ADD COLUMN IF NOT EXISTS state_unit VARCHAR(40)")
    op.execute("ALTER TABLE entity_snapshots ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ")
    op.execute(
        "ALTER TABLE entity_snapshots ADD COLUMN IF NOT EXISTS event_fingerprint VARCHAR(64)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_snapshot_event
          ON entity_snapshots (user_id, entity_id, aspect, event_fingerprint)
          WHERE event_fingerprint IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_snapshot_signal
          ON entity_snapshots (signal_id)
          WHERE signal_id IS NOT NULL
        """
    )

    # Directional stances in 018 were inferred from state movement rather than
    # compared with the user's belief. Preserve the links, but remove the false
    # direction and its derived confidence/status.
    op.execute(
        "UPDATE thread_signals SET stance = 'related' "
        "WHERE stance IN ('supporting', 'contradicting')"
    )
    op.execute(
        "UPDATE decision_threads SET confidence = NULL, previous_confidence = NULL, "
        "status = CASE WHEN status = 'reconsider' THEN 'open' ELSE status END"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_entity_snapshot_signal")
    op.execute("DROP INDEX IF EXISTS uq_entity_snapshot_event")
    op.execute("ALTER TABLE entity_snapshots DROP COLUMN IF EXISTS event_fingerprint")
    op.execute("ALTER TABLE entity_snapshots DROP COLUMN IF EXISTS effective_at")
    op.execute("ALTER TABLE entity_snapshots DROP COLUMN IF EXISTS state_unit")
    op.execute("ALTER TABLE entity_snapshots DROP COLUMN IF EXISTS state_value")
    op.execute("DROP INDEX IF EXISTS ix_signals_source_url")
    op.execute("DROP INDEX IF EXISTS uq_signal_event")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_source
          ON signals (user_id, entity_id, source_url)
        """
    )
    op.execute("ALTER TABLE signals DROP COLUMN IF EXISTS is_state_change")
    op.execute("ALTER TABLE signals DROP COLUMN IF EXISTS is_material_change")
    op.execute("ALTER TABLE signals DROP COLUMN IF EXISTS event_fingerprint")
    op.execute("DROP INDEX IF EXISTS ix_entity_alerts_source_url")
    op.execute("DROP INDEX IF EXISTS uq_entity_alert_event")
    op.execute("ALTER TABLE entity_alerts DROP COLUMN IF EXISTS event_fingerprint")
