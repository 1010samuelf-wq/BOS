"""products.name_ok — a person checked a flagged name and it's meant to be that way

Revision ID: 0032_product_name_ok
Revises: 0031_product_baker_name
Create Date: 2026-11-25
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0032_product_name_ok"
down_revision = "0031_product_baker_name"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    # Guarded: 0001_initial builds the whole schema from the current models.
    if _has_column(op.get_bind(), "products", "name_ok"):
        return
    op.add_column(
        "products",
        sa.Column("name_ok", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    if _has_column(op.get_bind(), "products", "name_ok"):
        op.drop_column("products", "name_ok")
