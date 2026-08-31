from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = None
    notes: str | None = None


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = None
    notes: str | None = None
    active: bool | None = None


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone: str | None
    address: str | None
    notes: str | None
    active: bool


class CustomerOrderOut(BaseModel):
    """A row of the customer's order history — enough to recognise it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    order_date: datetime
    needed_for_date: datetime | None
    total: Decimal
    status: str
    paid_status: str
    for_whom: str | None  # who it was for, when ordered on someone's behalf
    items: str  # flattened "2x Babka, 1x Challah" for display


class CustomerDetailOut(CustomerOut):
    order_count: int      # paid, non-cancelled — cash basis, like every figure here
    lifetime_value: Decimal
    orders: list[CustomerOrderOut]


class MergeIn(BaseModel):
    """Fold `source_id` into this customer; the source record is removed."""

    source_id: int


class ReassignIn(BaseModel):
    """Move this order onto the customer in the path."""

    order_id: int
