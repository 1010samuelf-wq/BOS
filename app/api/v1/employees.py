"""Employee management — Admin only (spec §2E, §2G, §2I).

Admin creates the record (name + role), sets each employee's **per-section
permissions** (which override role defaults, see app/core/permissions.py), and
can reset a forgotten PIN or deactivate. "Remove" is a soft deactivate so
historical orders/time entries keep their references. Kept admin-only on purpose:
managing who-can-do-what is the one privilege-escalation surface we don't grant.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.core.errors import not_found
from app.core.permissions import GRANTABLE_SECTIONS, effective_sections
from app.database import get_db
from app.models import User
from app.schemas.employee import EmployeeCreate, EmployeeOut, EmployeeUpdate
from app.services import auth as auth_service

router = APIRouter(prefix="/employees", tags=["employees"])


def _out(u: User) -> EmployeeOut:
    return EmployeeOut(
        id=u.id, name=u.name, role=u.role, active=u.active, pin_set=u.pin_set,
        permissions=u.permissions,
        effective_sections=sorted(effective_sections(u)),
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
    db.commit()
    db.refresh(employee)
    return _out(employee)


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
    """Clear the employee's PIN and return them to first-login state (spec §2E)."""
    employee = auth_service.reset_pin(db, employee_id)
    db.commit()
    db.refresh(employee)
    return _out(employee)


@router.delete("/{employee_id}", response_model=EmployeeOut)
def deactivate_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    employee = db.get(User, employee_id)
    if employee is None:
        raise not_found(f"Employee {employee_id} not found")
    employee.active = False
    db.commit()
    db.refresh(employee)
    return _out(employee)