from decimal import Decimal

from pydantic import BaseModel, Field


class ProductListOut(BaseModel):
    name: str
    rows: int


class ProductListRow(BaseModel):
    name: str = Field(max_length=300)
    baker_name: str = Field(default="", max_length=300)
    price: str = Field(max_length=30)
    category: str | None = Field(default=None, max_length=100)
    note: str = Field(default="", max_length=500)
    include: bool = True


class ProductListImportIn(BaseModel):
    rows: list[ProductListRow] = Field(max_length=500)
    apply: bool = False


class ProductListChangeOut(BaseModel):
    action: str  # add | update | unchanged | skip | excluded
    name: str
    baker_name: str
    product_id: int | None
    old_name: str | None
    old_price: Decimal | None
    new_price: Decimal | None
    reason: str


class ProductListImportOut(BaseModel):
    applied: bool
    changes: list[ProductListChangeOut]
