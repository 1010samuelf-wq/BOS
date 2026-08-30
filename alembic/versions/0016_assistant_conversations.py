"""assistant: saved conversations and their messages

Per-employee chat history for the in-app assistant. Messages are the plain text
shown in the panel; tool calls are not stored, because every turn re-runs them
against live data rather than replaying old results.

Revision ID: 0016_assistant_conversations
Revises: 0015_feedback
Create Date: 2026-08-30
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0016_assistant_conversations"
down_revision = "0015_feedback"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    # Guarded: 0001_initial runs create_all against the *current* models, so on
    # a fresh database these already exist by the time this revision runs.
    if not _has_table(bind, "assistant_conversations"):
        op.create_table(
            "assistant_conversations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("title", sa.String(120), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_assistant_conversations_user_id", "assistant_conversations", ["user_id"]
        )

    if not _has_table(bind, "assistant_messages"):
        op.create_table(
            "assistant_messages",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "conversation_id", sa.Integer(),
                sa.ForeignKey("assistant_conversations.id"), nullable=False,
            ),
            sa.Column("role", sa.String(16), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            "ix_assistant_messages_conversation_id", "assistant_messages", ["conversation_id"]
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, "assistant_messages"):
        op.drop_table("assistant_messages")
    if _has_table(bind, "assistant_conversations"):
        op.drop_table("assistant_conversations")
