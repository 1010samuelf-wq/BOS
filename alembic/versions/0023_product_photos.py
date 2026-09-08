"""product_photos — several images per product

One photo per product was not enough: a cake looks different from the side, and
a customer browsing the website wants to open one and look properly.

`products.photo_url` stays, as the cover. It is not redundant — the installed
tablet binaries read that field, and tablets on the old runtime can no longer
be updated over the air, so removing it would break them with no remote fix.
The service layer keeps it mirroring the first photo.

Backfills one row per product that already has a photo, so nothing has to be
re-uploaded and every existing cover keeps its place.

Revision ID: 0023_product_photos
Revises: 0022_show_on_menu
Create Date: 2026-09-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0023_product_photos"
down_revision = "0022_show_on_menu"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the whole schema from the current models.
    if _has_table(bind, "product_photos"):
        return

    op.create_table(
        "product_photos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_product_photos_product_id", "product_photos", ["product_id"])

    # SQLite can't add a foreign key after the fact; skip it there as every
    # other migration in this project does.
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_product_photos_product", "product_photos", "products",
            ["product_id"], ["id"], ondelete="CASCADE",
        )

    # Existing covers become photo #1, so no one re-uploads anything.
    op.execute(
        sa.text(
            "INSERT INTO product_photos (product_id, url, position) "
            "SELECT id, photo_url, 0 FROM products "
            "WHERE photo_url IS NOT NULL AND photo_url <> ''"
        )
    )


def downgrade() -> None:
    if _has_table(op.get_bind(), "product_photos"):
        op.drop_table("product_photos")
