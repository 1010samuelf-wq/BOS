"""Products, ingredients, recipes (spec §5, §2C, §2I)."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    photo_url: Mapped[str | None] = mapped_column(String(500))

    recipe: Mapped[Recipe | None] = relationship(
        back_populates="product", uselist=False, cascade="all, delete-orphan"
    )


class Ingredient(Base, TimestampMixin):
    __tablename__ = "ingredients"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)  # kg/g/unit
    cost_per_unit: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    low_stock_threshold: Mapped[Decimal] = mapped_column(
        Numeric(12, 3), default=0, nullable=False
    )
    active: Mapped[bool] = mapped_column(default=True, nullable=False)


class Recipe(Base, TimestampMixin):
    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), unique=True, nullable=False
    )

    product: Mapped[Product] = relationship(back_populates="recipe")
    items: Mapped[list[RecipeItem]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan"
    )


class RecipeItem(Base):
    __tablename__ = "recipe_items"
    __table_args__ = (
        UniqueConstraint("recipe_id", "ingredient_id", name="uq_recipe_ingredient"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False
    )
    ingredient_id: Mapped[int] = mapped_column(
        ForeignKey("ingredients.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)

    recipe: Mapped[Recipe] = relationship(back_populates="items")
    ingredient: Mapped[Ingredient] = relationship()
