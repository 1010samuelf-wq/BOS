"""initial BOS schema

Creates every table from the models (models are the single source of truth),
then adds the Postgres-only bits the spec calls for: the ``pg_trgm`` extension
and a trigram index on ``products.name`` for the order-screen typeahead (§5),
plus a seeded ``system`` user that the Phase-1 auth stand-in falls back to.

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-06
"""
from alembic import op

from app.models import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)

    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_products_name_trgm "
            "ON products USING gin (name gin_trgm_ops)"
        )

    # Seed the fallback system user (see app/core/auth.py). Raw SQL so the
    # `role` value casts to the native `user_role` enum on Postgres — a bound
    # VARCHAR param won't cast implicitly — and created_at/updated_at fall back
    # to their column defaults. Works on SQLite too.
    op.execute(
        "INSERT INTO users (name, role, pin_set, active) "
        "VALUES ('system', 'admin', FALSE, TRUE)"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_products_name_trgm")
    Base.metadata.drop_all(bind=bind)
