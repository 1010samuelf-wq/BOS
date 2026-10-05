"""order_payments — deposits and part-payments

An order can be settled in instalments: $100 taken when it's booked, $300 on
collection. Each payment carries its own date because reports are cash-basis —
the two amounts are income on two different days, and booking both against the
order date would put collection money in the week the order was taken.

This moves revenue recognition off `orders.order_date` and onto the payment
dates, so **every already-paid order is backfilled with one payment row** or
its revenue would vanish from every past report. The backfill dates each row
from `paid_at` where it exists, falling back to `order_date` for the early
orders that predate that column being filled in.

`orders.paid_status` is deliberately left as a two-state flag. The tablet
renders it verbatim and treats anything other than "unpaid" as settled, so
adding "partial" would make a part-paid order look collected on a device that
can't be updated yet. Partly-paid orders stay "unpaid" until the balance is
zero, which is the safe reading.

Revision ID: 0026_order_payments
Revises: 0025_email_templates
Create Date: 2026-09-25
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision = "0026_order_payments"
down_revision = "0025_email_templates"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def _method_type(bind):
    """The existing payment_method enum, reused rather than recreated.

    `sa.Enum(..., create_type=False)` does **not** work: that keyword belongs to
    `postgresql.ENUM`, and `sa.Enum` quietly ignores it and emits CREATE TYPE
    anyway — which fails with DuplicateObject because 0001 already made the type.
    This cost one aborted deploy (caught by the release command, so nothing was
    applied). On SQLite `sa.Enum` is just a VARCHAR + CHECK, with no type to
    clash over.
    """
    if bind.dialect.name == "postgresql":
        return postgresql.ENUM(
            "cash", "card", "etransfer", name="payment_method", create_type=False
        )
    return sa.Enum("cash", "card", "etransfer", name="payment_method")


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the whole schema from the current models.
    if _has_table(bind, "order_payments"):
        return

    op.create_table(
        "order_payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), nullable=False, index=True),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        # Reuses the existing payment_method enum — see _method_type().
        sa.Column("method", _method_type(bind), nullable=True),
        sa.Column("received_on", sa.Date(), nullable=False, index=True),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column("taken_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    # SQLite can't add a foreign key after the fact; skip it there, as every
    # other migration in this project does.
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_order_payments_order", "order_payments", "orders",
            ["order_id"], ["id"],
        )
        op.create_foreign_key(
            "fk_order_payments_taken_by", "order_payments", "users",
            ["taken_by"], ["id"],
        )

    # Backfill: one payment per already-paid order, or past revenue disappears.
    # COALESCE picks the payment date if we have one and the order date if not.
    # Cast to date explicitly — paid_at is tz-aware on Postgres and naive on
    # SQLite, and received_on is a plain date either way.
    if bind.dialect.name == "sqlite":
        received = "date(COALESCE(paid_at, order_date))"
    else:
        received = "COALESCE(paid_at, order_date)::date"

    op.execute(
        f"""
        INSERT INTO order_payments
            (order_id, amount, method, received_on, note, taken_by, created_at)
        SELECT id, total, payment_method, {received},
               'Backfilled from the order when part-payments were added',
               paid_by, COALESCE(paid_at, order_date)
        FROM orders
        WHERE paid_status = 'paid'
        """
    )


def downgrade() -> None:
    if _has_table(op.get_bind(), "order_payments"):
        op.drop_table("order_payments")
