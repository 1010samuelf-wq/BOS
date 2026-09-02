"""orders: expected_payment_method — how they said they'll pay

Staff want to record "he'll pay cash on pickup" when the order is taken, so the
day can be planned around what's coming in. Kept separate from payment_method,
which has to keep meaning "how it was actually settled" — that column feeds the
reports' cash/card/e-transfer breakdown, and filling it before any money moved
would have the reports counting payments nobody made.

Revision ID: 0021_expected_payment_method
Revises: 0020_trash_items
Create Date: 2026-09-02
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision = "0021_expected_payment_method"
down_revision = "0020_trash_items"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the schema from the current models.
    if _has_column(bind, "orders", "expected_payment_method"):
        return

    if bind.dialect.name == "postgresql":
        # The `payment_method` enum type already exists (payment_method uses
        # it). create_type=False stops Alembic issuing a second CREATE TYPE,
        # which would fail with "type already exists".
        column_type = postgresql.ENUM(
            "cash", "card", "etransfer", name="payment_method", create_type=False
        )
    else:
        # SQLite stores enums as VARCHAR with a CHECK; no shared type to reuse.
        column_type = sa.Enum("cash", "card", "etransfer", name="payment_method")

    op.add_column("orders", sa.Column("expected_payment_method", column_type, nullable=True))


def downgrade() -> None:
    if _has_column(op.get_bind(), "orders", "expected_payment_method"):
        op.drop_column("orders", "expected_payment_method")
