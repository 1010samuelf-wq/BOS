"""Employee management — Admin only (spec §2E, §2G, §2I).

Admin creates the record (name + role), sets each employee's **per-section
permissions** (which override role defaults, see app/core/permissions.py), and
can reset a forgotten PIN or deactivate. "Remove" is a soft deactivate so
historical orders/time entries keep their references. Kept admin-only on purpose:
managing who-can-do-what is the one privilege-escalation surface we don't grant.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.core.errors import conflict, not_found
from app.core.permissions import GRANTABLE_SECTIONS, effective_sections
from app.database import get_db
from app.models import (
    Expense,
    Order,
    OrderNote,
    StockAdjustment,
    Task,
    TimeEntry,
    User,
)
from app.schemas.employee import EmployeeCreate, EmployeeOut, EmployeeUpdate
from app.services import auth as auth_service

router = APIRouter(prefix="/employees", tags=["employees"])


def _has_activity(db: Session, uid: int) -> bool:
    """True if any record references this user, so a hard delete would orphan
    history (or violate a FK on Postgres). Such accounts stay soft-deactivated."""
    checks = [
        select(TimeEntry.id).where(TimeEntry.user_id == uid),
        select(Task.id).where(
            or_(Task.assigned_to == uid, Task.assigned_by == uid, Task.done_by == uid)
        ),
        select(Order.id).where(
            or_(Order.paid_by == uid, Order.fulfilled_by == uid,
                Order.cancelled_by == uid, Order.locked_by == uid)
        ),
        select(OrderNote.id).where(OrderNote.done_by == uid),
        select(Expense.id).where(Expense.logged_by == uid),
        select(StockAdjustment.id).where(StockAdjustment.adjusted_by == uid),
    ]
    return any(db.execute(stmt.limit(1)).first() is not None for stmt in checks)


def _out(u: User, setup_code: str | None = None) -> EmployeeOut:
    return EmployeeOut(
        id=u.id, name=u.name, role=u.role, active=u.active, pin_set=u.pin_set,
        hourly_rate=u.hourly_rate, permissions=u.permissions,
        effective_sections=sorted(effective_sections(u)),
        setup_code=setup_code,
    )


@router.get("/sections", response_model=list[str])
def grantable_sections(_: User = Depends(require_admin)):
    """The sections an admin can toggle per employee (for the editor UI)."""
    return GRANTABLE_SECTIONS


@router.post("", response_model=EmployeeOut, status_code=201)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    employee = User(name=payload.name, role=payload.role, pin_set=False, active=True)
    db.add(employee)
    db.flush()  # assign id before issuing the code
    code = auth_service.issue_setup_code(employee)
    db.commit()
    db.refresh(employee)
    return _out(employee, setup_code=code)


@router.get("", response_model=list[EmployeeOut])
def list_employees(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    stmt = select(User).order_by(User.name)
    if not include_inactive:
        stmt = stmt.where(User.active.is_(True))
    return [_out(e) for e in db.execute(stmt).scalars().all()]


@router.put("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Edit name/role/active and per-section `permissions`. Send
    `permissions: null` to clear the override (fall back to role defaults),
    `permissions: [...]` to set an explicit section list."""
    employee = db.get(User, employee_id)
    if employee is None:
        raise not_found(f"Employee {employee_id} not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(employee, k, v)
    db.commit()
    db.refresh(employee)
    return _out(employee)


@router.post("/{employee_id}/reset-pin", response_model=EmployeeOut)
def reset_pin(
    employee_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Clear the employee's PIN and return them to first-login state, issuing a
    fresh one-time setup code to hand over (spec §2E)."""
    employee, code = auth_service.reset_pin(db, employee_id)
    db.commit()
    db.refresh(employee)
    return _out(employee, setup_code=code)


@router.delete("/{employee_id}", response_model=EmployeeOut)
def deactivate_employee(
    employee_id: int,
    hard: bool = Query(default=False, description="permanently delete instead of deactivate"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Soft-deactivate by default (keeps history intact). `hard=true` permanently
    deletes — allowed only for an already-inactive account with no history, so we
    never orphan orders/tasks/time entries."""
    employee = db.get(User, employee_id)
    if employee is None:
        raise not_found(f"Employee {employee_id} not found")

    if hard:
        if employee.active:
            raise conflict(
                "Deactivate the employee before permanently deleting them.",
                code="employee_active",
            )
        if _has_activity(db, employee_id):
            raise conflict(
                "This employee has history (orders, tasks, or time entries) and "
                "can't be permanently deleted — leave them deactivated.",
                code="employee_has_activity",
            )
        out = _out(employee)  # snapshot before the row is gone
        db.delete(employee)
        db.commit()
        return out

    employee.active = False
    db.commit()
    db.refresh(employee)
    return _out(employee)