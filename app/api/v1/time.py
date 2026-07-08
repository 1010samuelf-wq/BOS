from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import current_user, require_manager
from app.core.errors import APIError
from app.core.permissions import require_section
from app.database import get_db
from app.models import User, UserRole
from app.models.base import utc_today
from app.schemas.time import (
    DayHours,
    TimeEntryCreate,
    TimeEntryOut,
    TimeEntryUpdate,
    WeeklyHoursOut,
)
from app.services import time_tracking

router = APIRouter(
    prefix="/time", tags=["time"],
    dependencies=[Depends(require_section("time"))],
)


def _is_manager(user: User) -> bool:
    return user.role in (UserRole.manager, UserRole.admin)


@router.post("/clock-in", response_model=TimeEntryOut)
def clock_in(db: Session = Depends(get_db), user: User = Depends(current_user)):
    entry = time_tracking.clock_in(db, user)
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/clock-out", response_model=TimeEntryOut)
def clock_out(db: Session = Depends(get_db), user: User = Depends(current_user)):
    entry = time_tracking.clock_out(db, user)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/entries", response_model=list[TimeEntryOut])
def list_entries(
    employee_id: int | None = Query(default=None, description="Manager only; defaults to caller"),
    from_: date | None = Query(default=None, alias="from"),
    to_: date | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Detailed punch log. Own by default; a manager/admin may query anyone (§2G)."""
    target_id = employee_id if employee_id is not None else user.id
    if target_id != user.id and not _is_manager(user):
        raise APIError(403, "forbidden", "Only a manager can view others' time.")
    return time_tracking.list_entries(db, target_id, from_, to_)


@router.post("/entries", response_model=TimeEntryOut, status_code=201)
def create_entry(
    payload: TimeEntryCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Add a missed punch (manager/admin)."""
    entry = time_tracking.create_entry(db, payload.user_id, payload.clock_in, payload.clock_out)
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/entries/{entry_id}", response_model=TimeEntryOut)
def update_entry(
    entry_id: int,
    payload: TimeEntryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Correct a punch (manager/admin). Only provided fields change."""
    entry = time_tracking.update_entry(db, entry_id, payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/entries/{entry_id}", status_code=204)
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    time_tracking.delete_entry(db, entry_id)
    db.commit()


@router.get("/hours", response_model=WeeklyHoursOut)
def weekly_hours(
    employee_id: int | None = Query(
        default=None, description="Admin only; defaults to the caller"
    ),
    week: date | None = Query(
        default=None, description="Any day in the target week; defaults to today"
    ),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Own hours by default. Only an Admin may query another employee (§2G)."""
    target_id = employee_id if employee_id is not None else user.id
    if target_id != user.id and user.role != UserRole.admin:
        raise APIError(403, "forbidden", "Only an Admin can view others' hours.")

    any_day = week or utc_today()
    monday, sunday, days, total, open_entry = time_tracking.weekly_hours(
        db, target_id, any_day
    )
    return WeeklyHoursOut(
        user_id=target_id,
        week_start=monday,
        week_end=sunday,
        days=[DayHours(day=d, hours=h) for d, h in days],
        total_hours=total,
        open_entry=open_entry,
    )
