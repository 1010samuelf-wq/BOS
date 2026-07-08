"""link notifications to tasks

Adds notifications.related_task_id so overdue-task alerts can point back to the
task (spec §2H/§2J).

Note: revision 0001 builds the schema via ``Base.metadata.create_all`` against
the current models, so a *fresh* database already has this column (and its FK).
This migration is therefore guarded to be a no-op when the column is present —
it only does real work for a database that was stamped at 0001 *before* this
column existed. FK creation is skipped on SQLite (ALTER can't add one there).

Revision ID: 0002_notif_task
Revises: 0001_initial
Create Date: 2026-07-06
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0002_notif_task"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "notifications", "related_task_id"):
        return  # fresh DB already has it via create_all in 0001

    op.add_column(
        "notifications",
        sa.Column("related_task_id", sa.Integer(), nullable=True),
    )
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_notifications_related_task_id_tasks",
            "notifications",
            "tasks",
            ["related_task_id"],
            ["id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    if not _has_column(bind, "notifications", "related_task_id"):
        return
    if bind.dialect.name != "sqlite":
        op.drop_constraint(
            "fk_notifications_related_task_id_tasks",
            "notifications",
            type_="foreignkey",
        )
    op.drop_column("notifications", "related_task_id")
