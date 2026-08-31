"""Decision Threads tables."""

from alembic import op

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS decision_threads (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title VARCHAR(80) NOT NULL,
          question TEXT NOT NULL,
          current_belief TEXT DEFAULT '',
          confidence DOUBLE PRECISION,
          previous_confidence DOUBLE PRECISION,
          status VARCHAR(20) DEFAULT 'open',
          source VARCHAR(20) DEFAULT 'user',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_decision_threads_user ON decision_threads (user_id, status)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_thread_question
          ON decision_threads (user_id, question)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS thread_signals (
          id VARCHAR(36) PRIMARY KEY,
          thread_id VARCHAR(36) NOT NULL REFERENCES decision_threads(id) ON DELETE CASCADE,
          signal_id VARCHAR(36) NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
          stance VARCHAR(20) DEFAULT 'related',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_thread_signals_thread ON thread_signals (thread_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_thread_signals_signal ON thread_signals (signal_id)"
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_signal
          ON thread_signals (thread_id, signal_id)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS thread_updates (
          id VARCHAR(36) PRIMARY KEY,
          thread_id VARCHAR(36) NOT NULL REFERENCES decision_threads(id) ON DELETE CASCADE,
          belief TEXT DEFAULT '',
          confidence DOUBLE PRECISION,
          previous_confidence DOUBLE PRECISION,
          note TEXT DEFAULT '',
          signal_id VARCHAR(36) REFERENCES signals(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_thread_updates_thread ON thread_updates (thread_id, created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS thread_updates")
    op.execute("DROP TABLE IF EXISTS thread_signals")
    op.execute("DROP TABLE IF EXISTS decision_threads")
