"""products.baker_name — which row of the baker's list a product came from

Revision ID: 0031_product_baker_name
Revises: 0030_failed_login_window
Create Date: 2026-11-12
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0031_product_baker_name"
down_revision = "0030_failed_login_window"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    # Guarded: 0001_initial builds the whole schema from the current models.
    if _has_column(op.get_bind(), "products", "baker_name"):
        return
    op.add_column("products", sa.Column("baker_name", sa.String(300), nullable=True))


def downgrade() -> None:
    if _has_column(op.get_bind(), "products", "baker_name"):
        op.drop_column("products", "baker_name")
