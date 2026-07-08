"""ingredient active flag

Adds ingredients.active (bool, default true) so an Admin can deactivate an
ingredient without deleting it — deactivated ones drop out of the catalog's
active filter but stay referenced by existing recipes. Guarded to be a no-op on
a fresh DB, where revision 0001's create_all already builds it.

Revision ID: 0005_ingredient_active
Revises: 0004_user_perms
Create Date: 2026-07-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0005_ingredient_active"
down_revision = "0004_user_perms"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "ingredients", "active"):
        return
    op.add_column(
        "ingredients",
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    # drop the server_default so the app-level default (True) governs new rows
    op.alter_column("ingredients", "active", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "ingredients", "active"):
        op.drop_column("ingredients", "active")
