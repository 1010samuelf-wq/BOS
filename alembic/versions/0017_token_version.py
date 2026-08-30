"""users: token_version, so sessions can be retired before they expire

A JWT is valid until it expires (12h by default), which on a shared shop tablet
means a lost device stays signed in for the rest of the day. Tokens now carry
the version they were minted with; bumping this column retires every one of
them at once.

Revision ID: 0017_token_version
Revises: 0016_assistant_conversations
Create Date: 2026-08-30
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0017_token_version"
down_revision = "0016_assistant_conversations"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # Guarded: 0001_initial builds the schema from the current models, so on a
    # fresh database this column already exists by the time we get here.
    if _has_column(bind, "users", "token_version"):
        return
    # server_default is required, not cosmetic: 0001 seeds the system admin via
    # raw SQL that doesn't name this column, so without it that INSERT fails on
    # a from-scratch upgrade.
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    if _has_column(op.get_bind(), "users", "token_version"):
        op.drop_column("users", "token_version")
