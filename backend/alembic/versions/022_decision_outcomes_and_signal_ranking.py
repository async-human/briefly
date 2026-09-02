"""Decision outcomes and inspectable learned signal priority."""

from alembic import op


revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE signals ADD COLUMN IF NOT EXISTS priority_score DOUBLE PRECISION NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE signals ADD COLUMN IF NOT EXISTS ranking_factors JSONB NOT NULL DEFAULT '{}'::jsonb")
    op.execute(
        """
        UPDATE signals
        SET priority_score = LEAST(
              1,
              COALESCE(confidence, 0) * 0.28
              + CASE WHEN is_material_change THEN 0.10 ELSE 0 END
              + CASE WHEN is_state_change THEN 0.08 ELSE 0 END
              + 0.04
            ),
            ranking_factors = jsonb_build_object(
              'version', 'transparent-v1-backfill',
              'raw_relevance', 0,
              'raw_urgent', false,
              'reasons', jsonb_build_array('existing verified signal')
            )
        WHERE priority_score = 0
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS decision_outcomes (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          thread_id VARCHAR(36) REFERENCES decision_threads(id) ON DELETE SET NULL,
          signal_id VARCHAR(36) REFERENCES signals(id) ON DELETE SET NULL,
          digest_item_id VARCHAR(36) REFERENCES digest_items(id) ON DELETE SET NULL,
          outcome VARCHAR(32) NOT NULL,
          source VARCHAR(20) NOT NULL DEFAULT 'read',
          note TEXT,
          action TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_decision_outcomes_user_created ON decision_outcomes (user_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_decision_outcomes_thread ON decision_outcomes (thread_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_decision_outcomes_signal ON decision_outcomes (signal_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS decision_outcomes")
    op.execute("ALTER TABLE signals DROP COLUMN IF EXISTS ranking_factors")
    op.execute("ALTER TABLE signals DROP COLUMN IF EXISTS priority_score")
