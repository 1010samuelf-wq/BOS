"""orders: for_whom — who an order is ultimately for

A party planner orders on behalf of a different family each time. Staff were
encoding that in the customer name ("Herman - Srugo", "Herman - Frankl"), which
split one real customer into many records and lost their order history. The
planner is now one customer, and this column carries who each order was for.

Revision ID: 0019_order_for_whom
Revises: 0018_customers
Create Date: 2026-08-30
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0019_order_for_whom"
down_revision = "0018_customers"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the schema from the current models.
    if _has_column(bind, "orders", "for_whom"):
        return
    op.add_column("orders", sa.Column("for_whom", sa.String(200), nullable=True))


def downgrade() -> None:
    if _has_column(op.get_bind(), "orders", "for_whom"):
        op.drop_column("orders", "for_whom")
