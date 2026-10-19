"""login_attempts — PIN lockout per employee and address

Revision ID: 0029_login_attempts
Revises: 0028_vendor_invoice_paid
Create Date: 2026-10-19
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0029_login_attempts"
down_revision = "0028_vendor_invoice_paid"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the whole schema from the current models.
    if _has_table(bind, "login_attempts"):
        return

    op.create_table(
        "login_attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("ip", sa.String(64), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "ip", name="uq_login_attempts_user_ip"),
    )

    # SQLite can't add a foreign key after the fact; skip it there, as every
    # other migration in this project does.
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_login_attempts_user_id", "login_attempts", "users",
            ["user_id"], ["id"],
        )


def downgrade() -> None:
    if _has_table(op.get_bind(), "login_attempts"):
        op.drop_table("login_attempts")
