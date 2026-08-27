from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class FeedbackCreate(BaseModel):
    """A note sent from the dashboard or the tablet."""

    message: str = Field(min_length=1, max_length=2000)
    source: str = Field(pattern="^(web|tablet)$")
    context: str | None = Field(default=None, max_length=200)


class FeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    message: str
    source: str
    context: str | None
    user_id: int | None
    user_name: str | None = None  # resolved by the service, not a column
    created_at: datetime
    handled: bool
    handled_by: int | None
    handled_at: datetime | None

    @field_serializer("created_at", "handled_at")
    def _as_utc(self, dt: datetime | None) -> str | None:
        """Always emit explicit-UTC ISO. Times are stored UTC but SQLite drops
        tzinfo on round-trip, and a client reading a naive value as local would
        misdate every entry (same reason TimeEntryOut does this)."""
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()


class FeedbackHandledIn(BaseModel):
    handled: bool = True
