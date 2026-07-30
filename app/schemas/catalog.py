from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Fixed preset — the only categories a product can be assigned (spec: menu
# filters + a consistent dropdown instead of free-text). Order here is the
# display order everywhere (Settings dropdown, public menu filter tabs).
PRODUCT_CATEGORIES: list[str] = [
    "Pareve Miniatures",
    "Pareve Cakes",
    "Dairy Miniatures",
    "Dairy Cakes",
    "Tarts",
    "Seasonal",
]
ProductCategory = Literal[
    "Pareve Miniatures", "Pareve Cakes", "Dairy Miniatures", "Dairy Cakes", "Tarts", "Seasonal",
]


# ---- Products ----
class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    price: Decimal = Field(ge=0)
    category: ProductCategory | None = None
    active: bool = True
    photo_url: str | None = None


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    price: Decimal | None = Field(default=None, ge=0)
    category: ProductCategory | None = None
    active: bool | None = None
    photo_url: str | None = None


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    price: Decimal
    category: str | None
    active: bool
    photo_url: str | None


class PublicProductOut(BaseModel):
    """Trimmed for the public menu site (justcakeskosher.com) — no `active`
    flag or anything internal, just what a customer needs to pick items."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    price: Decimal
    category: str | None
    photo_url: str | None


# ---- Ingredients ----
class IngredientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    unit: str = Field(min_length=1, max_length=20)
    cost_per_unit: Decimal = Field(ge=0)
    low_stock_threshold: Decimal = Field(default=Decimal(0), ge=0)
    active: bool = True


class IngredientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    unit: str | None = Field(default=None, min_length=1, max_length=20)
    cost_per_unit: Decimal | None = Field(default=None, ge=0)
    low_stock_threshold: Decimal | None = Field(default=None, ge=0)
    active: bool | None = None


class IngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    unit: str
    cost_per_unit: Decimal
    low_stock_threshold: Decimal
    active: bool


# ---- Recipes ----
class RecipeItemIn(BaseModel):
    ingredient_id: int
    quantity: Decimal = Field(gt=0)


class RecipeItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ingredient_id: int
    quantity: Decimal


class RecipeCreate(BaseModel):
    product_id: int
    yield_qty: int = Field(default=1, ge=1)
    items: list[RecipeItemIn] = Field(min_length=1)


class RecipeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    yield_qty: int
    items: list[RecipeItemOut]
