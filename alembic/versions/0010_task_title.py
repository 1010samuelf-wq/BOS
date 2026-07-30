"""tasks: add title, make description optional

Adds tasks.title (the short label the UI now requires; description becomes
optional supplementary notes). Backfills title from the existing description
so old rows stay usable, then relaxes description to nullable.

Revision ID: 0010_task_title
Revises: 0009_payroll
Create Date: 2026-07-17
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0010_task_title"
down_revision = "0009_payroll"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspect(bind).get_columns(table)}


def _is_nullable(bind, table: str, column: str) -> bool:
    return next(c["nullable"] for c in inspect(bind).get_columns(table) if c["name"] == column)


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_column(bind, "tasks", "title"):
        op.add_column("tasks", sa.Column("title", sa.Text(), nullable=True))
        tasks = sa.table("tasks", sa.column("title", sa.Text), sa.column("description", sa.Text))
        op.execute(tasks.update().where(tasks.c.title.is_(None)).values(title=tasks.c.description))
        op.alter_column("tasks", "title", nullable=False)
    if not _is_nullable(bind, "tasks", "description"):
        op.alter_column("tasks", "description", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    if _is_nullable(bind, "tasks", "description"):
        tasks = sa.table("tasks", sa.column("description", sa.Text))
        op.execute(tasks.update().where(tasks.c.description.is_(None)).values(description=""))
        op.alter_column("tasks", "description", existing_type=sa.Text(), nullable=False)
    if _has_column(bind, "tasks", "title"):
        op.drop_column("tasks", "title")
