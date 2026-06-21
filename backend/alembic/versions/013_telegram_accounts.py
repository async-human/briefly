"""Telegram accounts — links a Briefly user to a Telegram chat (channel adapter)."""

from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "telegram_accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=True),
        sa.Column("telegram_user_id", sa.BigInteger(), nullable=True),
        sa.Column("username", sa.String(64), nullable=True),
        sa.Column("thread_id", sa.String(36), nullable=True),
        sa.Column("voice_replies", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("proactive_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("link_code", sa.String(64), nullable=True),
        sa.Column("link_code_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("uq_telegram_account_user", "telegram_accounts", ["user_id"], unique=True)
    op.create_index("uq_telegram_account_chat", "telegram_accounts", ["chat_id"], unique=True)
    op.create_index("ix_telegram_account_link_code", "telegram_accounts", ["link_code"])


def downgrade() -> None:
    op.drop_index("ix_telegram_account_link_code", table_name="telegram_accounts")
    op.drop_index("uq_telegram_account_chat", table_name="telegram_accounts")
    op.drop_index("uq_telegram_account_user", table_name="telegram_accounts")
    op.drop_table("telegram_accounts")
