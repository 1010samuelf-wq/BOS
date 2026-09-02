from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import CompanyType, LedgerEntryType


class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: CompanyType


class CompanyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    type: CompanyType | None = None
    active: bool | None = None


class LedgerEntryCreate(BaseModel):
    entry_date: date
    type: LedgerEntryType
    amount: Decimal = Field(gt=0)
    note: str | None = Field(default=None, max_length=500)


class LedgerEntryUpdate(BaseModel):
    """A partial edit of one ledger line.

    Every field is optional and applied only when actually sent — the same
    exclude_unset discipline as order updates, so editing a note doesn't blank
    the amount.
    """

    entry_date: date | None = None
    type: LedgerEntryType | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    note: str | None = Field(default=None, max_length=500)


class LedgerEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    entry_date: date
    type: LedgerEntryType
    amount: Decimal
    note: str | None


class CompanyOut(BaseModel):
    """List view — no entries, just enough to render the section list with
    balances (spec: name + total balance per company, red/green by type)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: CompanyType
    active: bool
    balance: Decimal  # sum(charges) - sum(payments); computed, never stored


class CompanyDetailOut(CompanyOut):
    entries: list[LedgerEntryOut]
