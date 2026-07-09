"""payroll: hourly rate + paid time entries

Adds users.hourly_rate (pay rate) and time_entries.paid (has this shift been
paid out). Guarded + server_default so they apply cleanly to populated tables.

Revision ID: 0009_payroll
Revises: 0008_recipe_yield
Create Date: 2026-07-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0009_payroll"
down_revision = "0008_recipe_yield"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_column(bind, "users", "hourly_rate"):
        op.add_column(
            "users",
            sa.Column("hourly_rate", sa.Numeric(10, 2), nullable=False, server_default="0"),
        )
        op.alter_column("users", "hourly_rate", server_default=None)
    if not _has_column(bind, "time_entries", "paid"):
        op.add_column(
            "time_entries",
            sa.Column("paid", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.alter_column("time_entries", "paid", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "time_entries", "paid"):
        op.drop_column("time_entries", "paid")
    if _has_column(bind, "users", "hourly_rate"):
        op.drop_column("users", "hourly_rate")
