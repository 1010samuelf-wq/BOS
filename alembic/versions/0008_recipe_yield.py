"""recipe yield quantity

Adds recipes.yield_qty (units produced per batch) so cost-per-unit can be
computed (total ingredient cost / yield). Guarded + server_default so it applies
cleanly to a table that already has recipes.

Revision ID: 0008_recipe_yield
Revises: 0007_delivery_name
Create Date: 2026-07-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0008_recipe_yield"
down_revision = "0007_delivery_name"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "recipes", "yield_qty"):
        return
    op.add_column(
        "recipes",
        sa.Column("yield_qty", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("recipes", "yield_qty", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "recipes", "yield_qty"):
        op.drop_column("recipes", "yield_qty")
