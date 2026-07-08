from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.core.errors import APIError
from app.core.permissions import require_section
from app.database import get_db
from app.models import User, UserRole
from app.models.base import utc_today
from app.schemas.time import DayHours, TimeEntryOut, WeeklyHoursOut
from app.services import time_tracking

router = APIRouter(
    prefix="/time", tags=["time"],
    dependencies=[Depends(require_section("time"))],
)


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
