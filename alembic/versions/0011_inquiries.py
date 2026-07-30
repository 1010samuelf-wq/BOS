"""inquiries: public-site "select & submit, we'll call you" requests

Adds the inquiries table backing justcakeskosher.com's public menu. Not a
formal Order — just a name/phone + a snapshot of what they picked, for staff
to call back and place the real order through the normal app flow.

Revision ID: 0011_inquiries
Revises: 0010_task_title
Create Date: 2026-07-20
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0011_inquiries"
down_revision = "0010_task_title"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_table(bind, "inquiries"):
        op.create_table(
            "inquiries",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("customer_name", sa.String(200), nullable=False),
            sa.Column("customer_phone", sa.String(50), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("items_json", sa.Text(), nullable=False),
            sa.Column("handled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("handled_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, "inquiries"):
        op.drop_table("inquiries")
