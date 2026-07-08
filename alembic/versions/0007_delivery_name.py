"""order delivery recipient name

Adds orders.delivery_name (the person receiving a delivery, distinct from the
client who placed the order). Guarded to be a no-op on a fresh DB, where
revision 0001's create_all already builds it.

Revision ID: 0007_delivery_name
Revises: 0006_auth_hardening
Create Date: 2026-07-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0007_delivery_name"
down_revision = "0006_auth_hardening"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "orders", "delivery_name"):
        return
    op.add_column("orders", sa.Column("delivery_name", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "orders", "delivery_name"):
        op.drop_column("orders", "delivery_name")
