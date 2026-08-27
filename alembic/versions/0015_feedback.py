"""feedback: staff notes sent from any screen of the dashboard or tablet

Adds a single `feedback` table. `source` is a plain VARCHAR rather than a
native enum so adding a future client needs no migration.

Revision ID: 0015_feedback
Revises: 0014_offline_sync
Create Date: 2026-08-26
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0015_feedback"
down_revision = "0014_offline_sync"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    # Guarded: 0001_initial runs create_all against the *current* models, so on
    # a fresh database this table already exists by the time we get here.
    if _has_table(bind, "feedback"):
        return

    op.create_table(
        "feedback",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("context", sa.String(200), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("handled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("handled_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_feedback_user_id", "feedback", ["user_id"])


def downgrade() -> None:
    if _has_table(op.get_bind(), "feedback"):
        op.drop_table("feedback")
