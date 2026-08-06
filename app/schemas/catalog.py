from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# Seed categories, always offered first and in this order. Staff can add their
# own from the product form, so this is a starting point rather than a closed
# set — GET /products/categories returns these plus whatever is actually in use.
PRODUCT_CATEGORIES: list[str] = [
    "Pareve Miniatures",
    "Pareve Cakes",
    "Dairy Miniatures",
    "Dairy Cakes",
    "Tarts",
    "Seasonal",
]

# Free text so a new category needs no code change, but bounded and stripped so
# " Tarts" and "Tarts" don't become two categories that look identical in a list.
ProductCategory = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


def merge_categories(in_use: Iterable[str | None]) -> list[str]:
    """The category list to show in pickers: presets first in their display
    order, then anything staff have added since, alphabetically."""
    extras = sorted({c for c in in_use if c and c not in PRODUCT_CATEGORIES})
    return PRODUCT_CATEGORIES + extras


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
