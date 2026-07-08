"""Minimal Products / Ingredients / Recipes CRUD.

Phase 1 needs these so orders can reference real products and recipe-based
deduction has something to deduct. Writes are Admin-only (spec §4/§2I); reads
require any authenticated user.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_any_section, require_section
from app.core.errors import bad_request, not_found
from app.database import get_db
from app.models import Ingredient, Product, Recipe, RecipeItem, User
from app.schemas.catalog import (
    IngredientCreate,
    IngredientOut,
    IngredientUpdate,
    ProductCreate,
    ProductOut,
    ProductUpdate,
    RecipeCreate,
    RecipeOut,
)

router = APIRouter(tags=["catalog"])


# ---- Products ----
@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    product = Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.get("/products", response_model=list[ProductOut])
def list_products(
    active: bool | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_any_section("orders", "settings")),
):
    stmt = select(Product).order_by(Product.name)
    if active is not None:
        stmt = stmt.where(Product.active == active)
    return db.execute(stmt).scalars().all()


@router.get("/products/search", response_model=list[ProductOut])
def search_products(
    q: str = Query(min_length=1, description="typeahead query"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    _: User = Depends(require_any_section("orders", "settings")),
):
    """Search-as-you-type for the order screen (spec §2A, §5).

    Substring (case-insensitive) match over active product names, ranked so
    prefix matches come first (e.g. "cro" → "Croissant" ahead of "Macaron").
    On Postgres the ILIKE is served by the `pg_trgm` GIN index on
    `products.name`; on SQLite it falls back to a plain scan (fine for tests).
    """
    like = f"%{q}%"
    prefix = f"{q}%"
    stmt = (
        select(Product)
        .where(Product.active.is_(True), Product.name.ilike(like))
        .order_by(Product.name.ilike(prefix).desc(), Product.name)
        .limit(limit)
    )
    return db.execute(stmt).scalars().all()


@router.put("/products/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    product = db.get(Product, product_id)
    if product is None:
        raise not_found(f"Product {product_id} not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(product, k, v)
    db.commit()
    db.refresh(product)
    return product


# ---- Ingredients ----
@router.post("/ingredients", response_model=IngredientOut, status_code=201)
def create_ingredient(
    payload: IngredientCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    ingredient = Ingredient(**payload.model_dump())
    db.add(ingredient)
    db.commit()
    db.refresh(ingredient)
    return ingredient


@router.get("/ingredients", response_model=list[IngredientOut])
def list_ingredients(
    active: bool | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    stmt = select(Ingredient).order_by(Ingredient.name)
    if active is not None:
        stmt = stmt.where(Ingredient.active == active)
    return db.execute(stmt).scalars().all()


@router.put("/ingredients/{ingredient_id}", response_model=IngredientOut)
def update_ingredient(
    ingredient_id: int,
    payload: IngredientUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    ingredient = db.get(Ingredient, ingredient_id)
    if ingredient is None:
        raise not_found(f"Ingredient {ingredient_id} not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(ingredient, k, v)
    db.commit()
    db.refresh(ingredient)
    return ingredient


# ---- Recipes ----
@router.post("/recipes", response_model=RecipeOut, status_code=201)
def upsert_recipe(
    payload: RecipeCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    product = db.get(Product, payload.product_id)
    if product is None:
        raise bad_request(
            f"Product {payload.product_id} not found", code="unknown_product"
        )
    for item in payload.items:
        if db.get(Ingredient, item.ingredient_id) is None:
            raise bad_request(
                f"Ingredient {item.ingredient_id} not found",
                code="unknown_ingredient",
            )

    recipe = db.execute(
        select(Recipe)
        .where(Recipe.product_id == payload.product_id)
        .options(selectinload(Recipe.items))
    ).scalar_one_or_none()
    if recipe is None:
        recipe = Recipe(product_id=payload.product_id)
        db.add(recipe)
    else:
        recipe.items.clear()
        db.flush()
    recipe.yield_qty = payload.yield_qty
    recipe.items = [
        RecipeItem(ingredient_id=i.ingredient_id, quantity=i.quantity)
        for i in payload.items
    ]
    db.commit()
    db.refresh(recipe)
    return recipe


@router.get("/recipes/{product_id}", response_model=RecipeOut)
def get_recipe(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    recipe = db.execute(
        select(Recipe)
        .where(Recipe.product_id == product_id)
        .options(selectinload(Recipe.items))
    ).scalar_one_or_none()
    if recipe is None:
        raise not_found(f"No recipe for product {product_id}")
    return recipe
