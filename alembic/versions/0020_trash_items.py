"""trash_items — deleted things, kept instead of destroyed

Deleting anything in the shop used to be final. A mistaken delete meant
retyping from memory, and a question about a removed ledger line had no
answer. Every delete now writes a snapshot here first.

The payload is JSON rather than foreign keys on purpose: the row it describes
is gone, so a key would either block the delete or dangle.

Revision ID: 0020_trash_items
Revises: 0019_order_for_whom
Create Date: 2026-09-02
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0020_trash_items"
down_revision = "0019_order_for_whom"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the whole schema from the current models, so
    # on a fresh DB this table already exists by the time we get here.
    if _has_table(bind, "trash_items"):
        return

    op.create_table(
        "trash_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("deleted_by", sa.Integer(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("restored_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_trash_items_kind", "trash_items", ["kind"])
    op.create_index("ix_trash_items_deleted_at", "trash_items", ["deleted_at"])

    # SQLite can't add a FK after the fact; skip it there, as every other
    # migration in this project does.
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_trash_items_deleted_by_users", "trash_items", "users",
            ["deleted_by"], ["id"],
        )


def downgrade() -> None:
    if _has_table(op.get_bind(), "trash_items"):
        op.drop_table("trash_items")
