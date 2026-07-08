"""Clock in/out + weekly hours aggregation (spec §2G).

`aggregate_week` is a pure function (no DB) so the hours math is unit-testable
in isolation (spec §10).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import bad_request, conflict, not_found
from app.models import TimeEntry, User
from app.models.base import utcnow


def _day_start_utc(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def week_bounds(any_day: date) -> tuple[date, date]:
    """Monday–Sunday containing `any_day`."""
    monday = any_day - timedelta(days=any_day.weekday())
    return monday, monday + timedelta(days=6)


def _as_aware(dt: datetime) -> datetime:
    # SQLite drops tzinfo on round-trip; treat naive as UTC.
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def aggregate_week(
    entries: list[tuple[datetime, datetime | None]],
    any_day: date,
    *,
    now: datetime | None = None,
) -> tuple[list[tuple[date, float]], float]:
    """Given (clock_in, clock_out) pairs, return per-day [(date, hours)] for the
    Mon–Sun week containing `any_day`, plus the weekly total.

    A shift's hours are attributed to its clock-in date. Open entries (no
    clock_out) count up to `now`. Hours are rounded to 2 dp.
    """
    now = now or utcnow()
    monday, sunday = week_bounds(any_day)
    per_day: dict[date, float] = {monday + timedelta(days=i): 0.0 for i in range(7)}

    for clock_in, clock_out in entries:
        clock_in = _as_aware(clock_in)
        end = _as_aware(clock_out) if clock_out is not None else now
        day = clock_in.date()
        if day < monday or day > sunday:
            continue
        seconds = (end - clock_in).total_seconds()
        if seconds > 0:
            per_day[day] += seconds / 3600.0

    days = [(d, round(per_day[d], 2)) for d in sorted(per_day)]
    total = round(sum(h for _, h in days), 2)
    return days, total


# ---- DB-backed operations ---------------------------------------------------
def _open_entry(db: Session, user_id: int) -> TimeEntry | None:
    return db.execute(
        select(TimeEntry)
        .where(TimeEntry.user_id == user_id, TimeEntry.clock_out.is_(None))
        .order_by(TimeEntry.id.desc())
    ).scalars().first()


def clock_in(db: Session, user: User) -> TimeEntry:
    if _open_entry(db, user.id) is not None:
        raise conflict("Already clocked in.", code="already_clocked_in")
    entry = TimeEntry(user_id=user.id, clock_in=utcnow())
    db.add(entry)
    db.flush()
    return entry


def clock_out(db: Session, user: User) -> TimeEntry:
    entry = _open_entry(db, user.id)
    if entry is None:
        raise conflict("Not currently clocked in.", code="not_clocked_in")
    entry.clock_out = utcnow()
    return entry


def list_entries(
    db: Session, user_id: int, start: date | None = None, end: date | None = None
) -> list[TimeEntry]:
    """All of an employee's punches (newest first), optionally within a date range
    (by clock-in day). Powers the detailed log + weekly timesheets (spec §2G)."""
    stmt = select(TimeEntry).where(TimeEntry.user_id == user_id)
    if start is not None:
        stmt = stmt.where(TimeEntry.clock_in >= _day_start_utc(start))
    if end is not None:
        stmt = stmt.where(TimeEntry.clock_in < _day_start_utc(end) + timedelta(days=1))
    return list(db.execute(stmt.order_by(TimeEntry.clock_in.desc())).scalars().all())


def _validate_pair(clock_in: datetime, clock_out: datetime | None) -> None:
    if clock_out is not None and clock_out <= clock_in:
        raise bad_request("Clock-out must be after clock-in.", code="bad_time_range")


def create_entry(
    db: Session, user_id: int, clock_in: datetime, clock_out: datetime | None
) -> TimeEntry:
    if db.get(User, user_id) is None:
        raise not_found(f"Employee {user_id} not found")
    _validate_pair(clock_in, clock_out)
    entry = TimeEntry(user_id=user_id, clock_in=clock_in, clock_out=clock_out)
    db.add(entry)
    db.flush()
    return entry


def update_entry(db: Session, entry_id: int, fields: dict) -> TimeEntry:
    entry = db.get(TimeEntry, entry_id)
    if entry is None:
        raise not_found(f"Time entry {entry_id} not found")
    new_in = fields.get("clock_in", entry.clock_in)
    new_out = fields.get("clock_out", entry.clock_out)
    _validate_pair(_as_aware(new_in), _as_aware(new_out) if new_out else None)
    if "clock_in" in fields:
        entry.clock_in = fields["clock_in"]
    if "clock_out" in fields:
        entry.clock_out = fields["clock_out"]
    return entry


def delete_entry(db: Session, entry_id: int) -> None:
    entry = db.get(TimeEntry, entry_id)
    if entry is None:
        raise not_found(f"Time entry {entry_id} not found")
    db.delete(entry)


def weekly_hours(db: Session, user_id: int, any_day: date):
    user = db.get(User, user_id)
    if user is None:
        raise not_found(f"Employee {user_id} not found")

    monday, sunday = week_bounds(any_day)
    # Pull entries whose clock-in falls in the week (attribution is by clock-in).
    rows = db.execute(
        select(TimeEntry).where(
            TimeEntry.user_id == user_id,
            TimeEntry.clock_in >= datetime(monday.year, monday.month, monday.day, tzinfo=timezone.utc),
            TimeEntry.clock_in < datetime(sunday.year, sunday.month, sunday.day, tzinfo=timezone.utc) + timedelta(days=1),
        ).order_by(TimeEntry.clock_in)
    ).scalars().all()

    days, total = aggregate_week(
        [(r.clock_in, r.clock_out) for r in rows], any_day
    )
    open_entry = _open_entry(db, user_id)
    return monday, sunday, days, total, open_entry
