from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TrashItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    label: str
    payload: dict
    deleted_by: int | None
    deleted_by_name: str | None = None
    deleted_at: datetime
    restored_at: datetime | None
    # Whether "Put back" should be offered — some kinds are kept for the record
    # but can't be safely re-inserted.
    restorable: bool = False
