"""users.failed_login_window_start — the employee-wide PIN ceiling ages out

Revision ID: 0030_failed_login_window
Revises: 0029_login_attempts
Create Date: 2026-10-19
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0030_failed_login_window"
down_revision = "0029_login_attempts"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    # Guarded: 0001_initial builds the whole schema from the current models.
    if _has_column(op.get_bind(), "users", "failed_login_window_start"):
        return
    op.add_column(
        "users",
        sa.Column("failed_login_window_start", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    if _has_column(op.get_bind(), "users", "failed_login_window_start"):
        op.drop_column("users", "failed_login_window_start")
