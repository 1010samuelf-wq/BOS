from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class PublicContactOut(BaseModel):
    business_name: str | None
    business_phone: str | None


class InquiryItemIn(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)


class InquiryCreate(BaseModel):
    """Public, unauthenticated submission from the justcakeskosher.com menu."""

    customer_name: str = Field(min_length=1, max_length=200)
    customer_phone: str = Field(min_length=1, max_length=50)
    note: str | None = None
    items: list[InquiryItemIn] = Field(min_length=1)


class InquiryItemOut(BaseModel):
    """Snapshot at submission time — stays meaningful even if the product's
    name/price changes later."""

    product_id: int
    product_name: str
    unit_price: Decimal
    quantity: int


class InquiryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_name: str
    customer_phone: str
    note: str | None
    items: list[InquiryItemOut]
    handled: bool
    handled_by: int | None
    handled_at: datetime | None
    created_at: datetime
