"""per-employee section permissions

Adds users.permissions (JSON list of section keys) for per-employee section
access that overrides role defaults (see app/core/permissions.py). Guarded to be
a no-op on a fresh DB, where revision 0001's create_all already builds it.

Revision ID: 0004_user_perms
Revises: 0003_app_settings
Create Date: 2026-07-07
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0004_user_perms"
down_revision = "0003_app_settings"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "users", "permissions"):
        return
    op.add_column("users", sa.Column("permissions", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "users", "permissions"):
        op.drop_column("users", "permissions")
