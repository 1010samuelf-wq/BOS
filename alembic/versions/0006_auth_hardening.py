"""auth hardening: setup codes + login lockout

Adds first-login setup-code gating (setup_code_hash, setup_code_expires_at) and
per-account login lockout (failed_login_count, locked_until) to users. Guarded
to be a no-op on a fresh DB, where revision 0001's create_all already builds
them.

Revision ID: 0006_auth_hardening
Revises: 0005_ingredient_active
Create Date: 2026-07-08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0006_auth_hardening"
down_revision = "0005_ingredient_active"
branch_labels = None
depends_on = None

_COLUMNS = {
    "setup_code_hash": sa.Column("setup_code_hash", sa.String(255), nullable=True),
    "setup_code_expires_at": sa.Column(
        "setup_code_expires_at", sa.DateTime(timezone=True), nullable=True
    ),
    "failed_login_count": sa.Column(
        "failed_login_count", sa.Integer(), nullable=False, server_default="0"
    ),
    "locked_until": sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
}


def _cols(bind) -> set[str]:
    return {c["name"] for c in inspect(bind).get_columns("users")}


def upgrade() -> None:
    bind = op.get_bind()
    have = _cols(bind)
    for name, column in _COLUMNS.items():
        if name not in have:
            op.add_column("users", column)
    # drop the transient server_default; the app-level default (0) governs new rows
    if "failed_login_count" not in have:
        op.alter_column("users", "failed_login_count", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    have = _cols(bind)
    for name in reversed(list(_COLUMNS)):
        if name in have:
            op.drop_column("users", name)
