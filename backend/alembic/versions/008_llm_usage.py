"""LLM cost ledger — per-call token usage by user, agent, and day."""

from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_usage",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("agent", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("usage_day", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_llm_usage_user_day", "llm_usage", ["user_id", "usage_day"])
    op.create_index("ix_llm_usage_agent_day", "llm_usage", ["agent", "usage_day"])
    op.create_index("ix_llm_usage_usage_day", "llm_usage", ["usage_day"])


def downgrade() -> None:
    op.drop_index("ix_llm_usage_usage_day", table_name="llm_usage")
    op.drop_index("ix_llm_usage_agent_day", table_name="llm_usage")
    op.drop_index("ix_llm_usage_user_day", table_name="llm_usage")
    op.drop_table("llm_usage")
