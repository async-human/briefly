"""Belief assessments — verified signal ↔ belief comparisons for temporal decision memory."""

from alembic import op


revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS belief_assessments (
          id VARCHAR(36) PRIMARY KEY,
          thread_id VARCHAR(36) NOT NULL REFERENCES decision_threads(id) ON DELETE CASCADE,
          signal_id VARCHAR(36) NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
          stance VARCHAR(32) NOT NULL,
          rationale TEXT NOT NULL DEFAULT '',
          assessor_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
          verifier VARCHAR(20) NOT NULL DEFAULT 'llm',
          evidence_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_belief_assessments_thread "
        "ON belief_assessments (thread_id, created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_belief_assessments_signal "
        "ON belief_assessments (signal_id)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_belief_assessment_thread_signal
          ON belief_assessments (thread_id, signal_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS belief_assessments")
