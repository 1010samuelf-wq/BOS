"""products: show_on_menu — whether it appears on the public website

Until now `active` did two jobs: whether staff can sell a product at all, and
whether it shows on justcakeskosher.com. So hiding something from the website
also removed it from search and the tap grid, which is not what anyone wanted.
This splits the second job out.

Defaults to true, so every existing product keeps appearing on the menu exactly
as it does today — the switch only matters once someone turns one off.

Revision ID: 0022_show_on_menu
Revises: 0021_expected_payment_method
Create Date: 2026-09-02
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0022_show_on_menu"
down_revision = "0021_expected_payment_method"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the schema from the current models.
    if _has_column(bind, "products", "show_on_menu"):
        return

    # server_default matters beyond the backfill: without it the NOT NULL add
    # fails on a table that already has rows.
    op.add_column(
        "products",
        sa.Column(
            "show_on_menu",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    if _has_column(op.get_bind(), "products", "show_on_menu"):
        op.drop_column("products", "show_on_menu")
