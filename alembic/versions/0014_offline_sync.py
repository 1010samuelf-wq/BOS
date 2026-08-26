"""offline sync: synced_operations audit/idempotency table

Backs the tablet's offline write-queue (spec: bakery-floor offline mode).
Keyed by a client-generated `client_op_id` so a queued action replayed twice
(e.g. after an app restart mid-sync) never double-applies. Mirrors the dedup
pattern `orders.idempotency_key` already uses, generalized to every queueable
op type instead of order-creation only.

Revision ID: 0014_offline_sync
Revises: 0013_bookkeeping
Create Date: 2026-08-23
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0014_offline_sync"
down_revision = "0013_bookkeeping"
branch_labels = None
depends_on = None


def _has_table(bind, table: str) -> bool:
    return table in inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table(bind, "synced_operations"):
        op.create_table(
            "synced_operations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("client_op_id", sa.String(64), nullable=False, unique=True),
            sa.Column("device_id", sa.String(64), nullable=False),
            sa.Column("op_type", sa.String(60), nullable=False),
            sa.Column("acting_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("request_fingerprint", sa.String(64), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("result_json", sa.Text(), nullable=True),
            sa.Column("error_code", sa.String(60), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("applied_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_synced_operations_client_op_id", "synced_operations", ["client_op_id"], unique=True)
        op.create_index("ix_synced_operations_device_id", "synced_operations", ["device_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, "synced_operations"):
        op.drop_table("synced_operations")
