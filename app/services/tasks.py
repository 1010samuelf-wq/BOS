"""Task assignment + completion (spec §2J)."""

from __future__ import annotations

from datetime import date, datetime, time, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import bad_request, not_found
from app.models import Task, User
from app.models.base import utcnow
from app.schemas.task import TaskCreate, TaskOut


def _as_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def is_overdue(task: Task, now: datetime | None = None) -> bool:
    if task.done or task.due_date is None:
        return False
    return _as_aware(task.due_date) < (now or utcnow())


def to_out(task: Task) -> TaskOut:
    out = TaskOut.model_validate(task)
    out.is_overdue = is_overdue(task)
    return out


def create_task(db: Session, payload: TaskCreate, creator: User) -> Task:
    assignee = db.get(User, payload.assigned_to)
    if assignee is None or not assignee.active:
        raise bad_request(
            f"Assignee {payload.assigned_to} not found or inactive",
            code="unknown_assignee",
        )
    task = Task(
        description=payload.description,
        assigned_to=payload.assigned_to,
        assigned_by=creator.id,
        due_date=payload.due_date,
        created_at=utcnow(),
    )
    db.add(task)
    db.flush()
    return task


def list_tasks(
    db: Session,
    *,
    employee_id: int | None = None,
    on_date: date | None = None,
    done: bool | None = None,
) -> list[Task]:
    stmt = select(Task)
    if employee_id is not None:
        stmt = stmt.where(Task.assigned_to == employee_id)
    if done is not None:
        stmt = stmt.where(Task.done == done)
    if on_date is not None:
        start = datetime.combine(on_date, time.min, tzinfo=timezone.utc)
        end = datetime.combine(on_date, time.max, tzinfo=timezone.utc)
        stmt = stmt.where(Task.due_date >= start, Task.due_date <= end)
    return db.execute(stmt.order_by(Task.due_date.is_(None), Task.due_date, Task.id)).scalars().all()


def set_done(db: Session, task_id: int, user: User, done: bool | None) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise not_found(f"Task {task_id} not found")
    new_state = (not task.done) if done is None else done
    task.done = new_state
    if new_state:
        task.done_at = utcnow()
        task.done_by = user.id
    else:
        task.done_at = None
        task.done_by = None
    return task
