"""app settings singleton (business profile)

Adds the `app_settings` table (spec §2I/§4). Guarded to be a no-op on a fresh
DB, where revision 0001's `create_all` already builds it from the models; it
does real work only for a DB stamped at an earlier revision. The singleton row
is created lazily by the settings service, so no seed is needed here.

Revision ID: 0003_app_settings
Revises: 0002_notif_task
Create Date: 2026-07-06
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0003_app_settings"
down_revision = "0002_notif_task"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "app_settings" in inspect(bind).get_table_names():
        return
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_name", sa.String(length=200), nullable=True),
        sa.Column("business_address", sa.String(length=400), nullable=True),
        sa.Column("business_phone", sa.String(length=40), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "app_settings" in inspect(bind).get_table_names():
        op.drop_table("app_settings")
