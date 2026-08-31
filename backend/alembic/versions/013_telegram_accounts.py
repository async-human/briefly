"""Telegram accounts — links a Briefly user to a Telegram chat (channel adapter)."""

from alembic import op

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # create_all() may have already created this table on Railway before Alembic
    # reached 013 — CREATE IF NOT EXISTS so upgrade can continue to 014.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS telegram_accounts (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            user_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            chat_id BIGINT,
            telegram_user_id BIGINT,
            username VARCHAR(64),
            thread_id VARCHAR(36),
            voice_replies BOOLEAN NOT NULL DEFAULT true,
            proactive_enabled BOOLEAN NOT NULL DEFAULT true,
            link_code VARCHAR(64),
            link_code_expires_at TIMESTAMP WITH TIME ZONE,
            linked_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_account_user "
        "ON telegram_accounts (user_id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_account_chat "
        "ON telegram_accounts (chat_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_telegram_account_link_code "
        "ON telegram_accounts (link_code)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_telegram_account_link_code")
    op.execute("DROP INDEX IF EXISTS uq_telegram_account_chat")
    op.execute("DROP INDEX IF EXISTS uq_telegram_account_user")
    op.execute("DROP TABLE IF EXISTS telegram_accounts")
