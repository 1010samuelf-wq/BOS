"""Stock levels + adjustment audit log (spec §2B, §5).

One `stock_levels` row per (item_type, item_id) — serving both ingredients and
products through the `ItemType` discriminator. Levels may go negative; stock is
advisory and never blocks a sale (spec §1).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.enums import ItemType


class StockLevel(Base):
    __tablename__ = "stock_levels"
    __table_args__ = (
        UniqueConstraint("item_type", "item_id", name="uq_stock_item"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    item_type: Mapped[ItemType] = mapped_column(
        SAEnum(ItemType, name="stock_item_type"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class StockAdjustment(Base):
    """Audit row for every change — manual adjustments, purchases, recipe
    deductions on sale, and cancellation reversals. `delta` is signed."""

    __tablename__ = "stock_adjustments"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_type: Mapped[ItemType] = mapped_column(
        SAEnum(ItemType, name="stock_item_type"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(nullable=False)
    delta: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    # Ties auto-deductions / reversals back to their order (nullable for manual).
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"))
    adjusted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
