from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class TimeEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    clock_in: datetime
    clock_out: datetime | None


class DayHours(BaseModel):
    day: date
    hours: float


class WeeklyHoursOut(BaseModel):
    user_id: int
    week_start: date          # Monday
    week_end: date            # Sunday
    days: list[DayHours]      # 7 rows, Mon–Sun
    total_hours: float
    open_entry: TimeEntryOut | None  # currently clocked-in, if any
