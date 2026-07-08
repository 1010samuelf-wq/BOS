from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import ItemType


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str  # low_stock / overdue_order / overdue_task
    message: str
    related_order_id: int | None
    related_task_id: int | None
    related_item_type: ItemType | None
    related_item_id: int | None
    read: bool
    created_at: datetime


class UnreadCountOut(BaseModel):
    unread: int
