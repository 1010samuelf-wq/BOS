"""products: normalize existing categories to the new fixed preset

One-time data fix: category is now a closed set (Pareve Miniatures/Pareve
Cakes/Dairy Miniatures/Dairy Cakes/Tarts/Seasonal) instead of free text.
Existing products had inconsistent free-text values ("Cakes", "minitures",
"Pareve", ...) — bulk-set them all to "Pareve Cakes" as requested; the owner
re-categorizes individually afterward via the new dropdown. Alembic only runs
this once (tracked in alembic_version), so later category edits are safe.

Revision ID: 0012_product_category_preset
Revises: 0011_inquiries
Create Date: 2026-07-21
"""
import sqlalchemy as sa
from alembic import op

revision = "0012_product_category_preset"
down_revision = "0011_inquiries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    products = sa.table("products", sa.column("category", sa.String))
    op.execute(products.update().values(category="Pareve Cakes"))


def downgrade() -> None:
    # Original free-text values aren't recoverable — this is a one-way cleanup.
    pass
