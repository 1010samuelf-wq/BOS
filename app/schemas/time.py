from __future__ import annotations

from datetime import date, datetime, timezone

from pydantic import BaseModel, ConfigDict, field_serializer


class TimeEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    clock_in: datetime
    clock_out: datetime | None

    @field_serializer("clock_in", "clock_out")
    def _as_utc(self, dt: datetime | None) -> str | None:
        """Always emit an explicit-UTC ISO string. Stored times are UTC, but
        SQLite drops tzinfo on round-trip; clients must not read a naive value as
        local time."""
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()


class TimeEntryCreate(BaseModel):
    """Manager adds a missed punch (spec §2G)."""

    user_id: int
    clock_in: datetime
    clock_out: datetime | None = None


class TimeEntryUpdate(BaseModel):
    """Manager fixes a punch. Only provided fields change; send clock_out=null to
    reopen an entry."""

    clock_in: datetime | None = None
    clock_out: datetime | None = None


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
