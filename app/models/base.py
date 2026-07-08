from datetime import date, datetime, timezone

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utc_today() -> date:
    """Today's date in UTC. Used for report/expense "today" defaults so they
    line up with `order_date`/`spent_on` which are stored in UTC — otherwise a
    machine east/west of UTC misfiles the current business day near midnight."""
    return datetime.now(timezone.utc).date()


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    """`created_at` server-defaulted; `updated_at` bumped on modification."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
