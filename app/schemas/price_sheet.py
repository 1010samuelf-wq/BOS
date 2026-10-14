from decimal import Decimal

from pydantic import BaseModel


class PriceSheetOut(BaseModel):
    name: str
    rows: int


class PriceChangeOut(BaseModel):
    action: str  # update | add | unchanged | skip
    name: str
    ingredient_id: int | None
    unit: str | None
    old_price: Decimal | None
    new_price: Decimal | None
    note: str
    reason: str


class PriceImportOut(BaseModel):
    sheet: str
    applied: bool
    changes: list[PriceChangeOut]
