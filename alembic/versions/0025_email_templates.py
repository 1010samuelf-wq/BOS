"""email_templates — saved product emails

A template holds the wording *and* the product selection, because re-ticking
fifteen products is the tedious part of sending the same email again.

Product ids, not a snapshot of names and prices: reopening a template should
send today's catalog at today's prices.

Revision ID: 0025_email_templates
Revises: 0024_ledger_invoice_number
Create Date: 2026-09-17
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0025_email_templates"
down_revision = "0024_ledger_invoice_number"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the whole schema from the current models.
    if _has_table(bind, "email_templates"):
        return

    op.create_table(
        "email_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("subject", sa.String(300), nullable=False, server_default=""),
        sa.Column("intro", sa.Text(), nullable=True),
        sa.Column("signoff", sa.Text(), nullable=True),
        sa.Column("product_ids", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    # SQLite can't add a foreign key after the fact; skip it there, as every
    # other migration in this project does.
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_email_templates_created_by", "email_templates", "users",
            ["created_by"], ["id"],
        )


def downgrade() -> None:
    if _has_table(op.get_bind(), "email_templates"):
        op.drop_table("email_templates")
