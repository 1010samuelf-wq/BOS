from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ExpenseCreate(BaseModel):
    description: str = Field(min_length=1, max_length=255)
    amount: Decimal = Field(ge=0)
    category: str | None = None
    spent_on: date | None = None  # defaults to today server-side


class ExpenseUpdate(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=255)
    amount: Decimal | None = Field(default=None, ge=0)
    category: str | None = None
    spent_on: date | None = None


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    description: str
    amount: Decimal
    category: str | None
    spent_on: date
    logged_by: int | None
