"""bookkeeping: accounts payable/receivable ledger per company

Adds bookkeeping_companies (name, payable/receivable type) and
bookkeeping_entries (dated charge/payment lines). A company's balance is
always derived from its entries, never stored.

Revision ID: 0013_bookkeeping
Revises: 0012_product_category_preset
Create Date: 2026-08-06
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0013_bookkeeping"
down_revision = "0012_product_category_preset"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table(bind, "bookkeeping_companies"):
        op.create_table(
            "bookkeeping_companies",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column(
                "type",
                sa.Enum("payable", "receivable", name="bookkeeping_company_type"),
                nullable=False,
            ),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    if not _has_table(bind, "bookkeeping_entries"):
        op.create_table(
            "bookkeeping_entries",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "company_id", sa.Integer(),
                sa.ForeignKey("bookkeeping_companies.id"), nullable=False,
            ),
            sa.Column("entry_date", sa.Date(), nullable=False),
            sa.Column(
                "type",
                sa.Enum("charge", "payment", name="bookkeeping_entry_type"),
                nullable=False,
            ),
            sa.Column("amount", sa.Numeric(10, 2), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("logged_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index(
            "ix_bookkeeping_entries_company_id", "bookkeeping_entries", ["company_id"]
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, "bookkeeping_entries"):
        op.drop_table("bookkeeping_entries")
    if _has_table(bind, "bookkeeping_companies"):
        op.drop_table("bookkeeping_companies")
    if bind.dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS bookkeeping_entry_type")
        op.execute("DROP TYPE IF EXISTS bookkeeping_company_type")
