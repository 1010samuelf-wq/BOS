"""Tasks (spec §2J).

- Create: Admin/Manager only.
- List: an employee sees their own; Admin/Manager can query any employee or all.
- Toggle done: the assignee or an Admin/Manager.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import current_user, require_manager
from app.core.errors import APIError, not_found
from app.core.permissions import require_section
from app.database import get_db
from app.models import Task, User, UserRole
from app.schemas.task import TaskCreate, TaskDoneIn, TaskOut
from app.services import tasks as task_service

router = APIRouter(
    prefix="/tasks", tags=["tasks"],
    dependencies=[Depends(require_section("tasks"))],
)


def _is_manager(user: User) -> bool:
    return user.role in (UserRole.manager, UserRole.admin)


@router.post("", response_model=TaskOut, status_code=201)
def create_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_manager),
):
    task = task_service.create_task(db, payload, user)
    db.commit()
    db.refresh(task)
    return task_service.to_out(task)


@router.get("", response_model=list[TaskOut])
def list_tasks(
    employee_id: int | None = Query(default=None),
    on_date: date | None = Query(default=None, alias="date"),
    done: bool | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if not _is_manager(user):
        # non-managers are scoped to their own tasks
        if employee_id is not None and employee_id != user.id:
            raise APIError(403, "forbidden", "You can only view your own tasks.")
        employee_id = user.id

    tasks = task_service.list_tasks(db, employee_id=employee_id, on_date=on_date, done=done)
    return [task_service.to_out(t) for t in tasks]


@router.post("/{task_id}/done", response_model=TaskOut)
def set_done(
    task_id: int,
    payload: TaskDoneIn | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    task = db.get(Task, task_id)
    if task is None:
        raise not_found(f"Task {task_id} not found")
    if task.assigned_to != user.id and not _is_manager(user):
        raise APIError(403, "forbidden", "You can only complete your own tasks.")

    task = task_service.set_done(db, task_id, user, payload.done if payload else None)
    db.commit()
    db.refresh(task)
    return task_service.to_out(task)
