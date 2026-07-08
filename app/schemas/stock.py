from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ItemType


class StockLevelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    item_type: ItemType
    item_id: int
    quantity: Decimal
    updated_at: datetime
    # Denormalised for convenience in the stock screen.
    name: str | None = None
    low_stock_threshold: Decimal | None = None
    is_low: bool | None = None


class StockAdjustIn(BaseModel):
    item_type: ItemType
    item_id: int
    # Signed delta: +restock, -waste/correction. Non-zero.
    delta: Decimal
    reason: str = Field(min_length=1, max_length=255)


class StockAdjustmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    item_type: ItemType
    item_id: int
    delta: Decimal
    reason: str
    order_id: int | None
    adjusted_by: int | None
    created_at: datetime
