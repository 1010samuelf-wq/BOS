from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    description: str | None = None
    assigned_to: int
    due_date: datetime | None = None


class TaskDoneIn(BaseModel):
    # Explicit set; omit the body to toggle current state.
    done: bool | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    assigned_to: int
    assigned_by: int
    due_date: datetime | None
    done: bool
    done_at: datetime | None
    done_by: int | None
    created_at: datetime
    is_overdue: bool = False  # due date passed and not done (spec §2J)
