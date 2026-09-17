"""bookkeeping_entries: note -> invoice_number

The field was called "Note" but the shop was only ever putting the supplier's
invoice number in it, and asked for it to say so. Renaming the column rather
than just the label keeps the data model honest about what it holds.

A rename, not a new column: existing values are invoice numbers already, so
there is nothing to migrate and nothing to lose.

Revision ID: 0024_ledger_invoice_number
Revises: 0023_product_photos
Create Date: 2026-09-15
"""
from alembic import op
from sqlalchemy import inspect

revision = "0024_ledger_invoice_number"
down_revision = "0023_product_photos"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _columns(bind, "bookkeeping_entries")
    # Guarded both ways: 0001_initial builds the schema from the current models,
    # so on a fresh DB the column is already named invoice_number and there is
    # no `note` to rename.
    if "invoice_number" in cols or "note" not in cols:
        return
    op.alter_column("bookkeeping_entries", "note", new_column_name="invoice_number")


def downgrade() -> None:
    bind = op.get_bind()
    cols = _columns(bind, "bookkeeping_entries")
    if "note" in cols or "invoice_number" not in cols:
        return
    op.alter_column("bookkeeping_entries", "invoice_number", new_column_name="note")
