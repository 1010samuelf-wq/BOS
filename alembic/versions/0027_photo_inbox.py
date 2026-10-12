"""photo_inbox — photos uploaded before anyone has said which product they are

Revision ID: 0027_photo_inbox
Revises: 0026_order_payments
Create Date: 2026-10-12
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0027_photo_inbox"
down_revision = "0026_order_payments"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the whole schema from the current models.
    if _has_table(bind, "photo_inbox"):
        return

    op.create_table(
        "photo_inbox",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("filename", sa.String(255), nullable=True),
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    )

    # SQLite can't add a foreign key after the fact; skip it there, as every
    # other migration in this project does.
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_photo_inbox_uploaded_by", "photo_inbox", "users",
            ["uploaded_by"], ["id"],
        )


def downgrade() -> None:
    if _has_table(op.get_bind(), "photo_inbox"):
        op.drop_table("photo_inbox")
