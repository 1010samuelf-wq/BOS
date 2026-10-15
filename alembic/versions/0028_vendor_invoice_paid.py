"""vendor invoices can be marked paid: bookkeeping_entries.paid_on,
payment_entry_id, expense_id

Revision ID: 0028_vendor_invoice_paid
Revises: 0027_photo_inbox
Create Date: 2026-10-15
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0028_vendor_invoice_paid"
down_revision = "0027_photo_inbox"
branch_labels = None
depends_on = None

TABLE = "bookkeeping_entries"


def _columns(bind) -> set[str]:
    return {c["name"] for c in inspect(bind).get_columns(TABLE)}


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the whole schema from the current models.
    have = _columns(bind)
    if "paid_on" not in have:
        op.add_column(TABLE, sa.Column("paid_on", sa.Date(), nullable=True))
    if "payment_entry_id" not in have:
        op.add_column(TABLE, sa.Column("payment_entry_id", sa.Integer(), nullable=True))
        if bind.dialect.name != "sqlite":
            op.create_foreign_key(
                "fk_bookkeeping_entries_payment_entry", TABLE, TABLE,
                ["payment_entry_id"], ["id"], ondelete="SET NULL",
            )
    if "expense_id" not in have:
        op.add_column(TABLE, sa.Column("expense_id", sa.Integer(), nullable=True))
        if bind.dialect.name != "sqlite":
            op.create_foreign_key(
                "fk_bookkeeping_entries_expense", TABLE, "expenses",
                ["expense_id"], ["id"], ondelete="SET NULL",
            )


def downgrade() -> None:
    bind = op.get_bind()
    have = _columns(bind)
    # Look the foreign keys up rather than assume their names: on a database
    # built fresh by 0001 (create_all) they carry generated names, not ours.
    if bind.dialect.name != "sqlite":
        for fk in inspect(bind).get_foreign_keys(TABLE):
            if set(fk["constrained_columns"]) & {"payment_entry_id", "expense_id"} and fk.get("name"):
                op.drop_constraint(fk["name"], TABLE, type_="foreignkey")
    for col in ("expense_id", "payment_entry_id", "paid_on"):
        if col in have:
            op.drop_column(TABLE, col)
