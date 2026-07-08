"""Stock mechanics (spec §1, §2B, §2C).

Golden rule: stock is *advisory*. A delta is always applied — levels are
allowed to go negative — and insufficient stock never raises or blocks. Every
change writes a signed `stock_adjustments` audit row, and crossing a low-stock
threshold writes a `notifications` row.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Ingredient,
    ItemType,
    Order,
    Product,
    StockAdjustment,
    StockLevel,
)
from app.models.base import utcnow

logger = logging.getLogger("bos.stock")


def _get_level_for_update(db: Session, item_type: ItemType, item_id: int) -> StockLevel:
    """Fetch (or lazily create) the stock row, locking it FOR UPDATE so
    concurrent deductions serialize instead of racing (spec §1 "server
    serializes every write"). SQLite ignores the lock hint, which is fine."""
    level = db.execute(
        select(StockLevel)
        .where(StockLevel.item_type == item_type, StockLevel.item_id == item_id)
        .with_for_update()
    ).scalar_one_or_none()
    if level is None:
        level = StockLevel(
            item_type=item_type, item_id=item_id, quantity=Decimal(0),
            updated_at=utcnow(),
        )
        db.add(level)
        db.flush()
    return level


def _threshold_for(db: Session, item_type: ItemType, item_id: int) -> Decimal:
    if item_type == ItemType.ingredient:
        ing = db.get(Ingredient, item_id)
        if ing is not None:
            return ing.low_stock_threshold
    # Products carry no explicit threshold: "low" means negative.
    return Decimal(0)


def _name_for(db: Session, item_type: ItemType, item_id: int) -> str | None:
    obj = db.get(
        Ingredient if item_type == ItemType.ingredient else Product, item_id
    )
    return obj.name if obj is not None else None


def apply_delta(
    db: Session,
    *,
    item_type: ItemType,
    item_id: int,
    delta: Decimal,
    reason: str,
    user_id: int | None,
    order_id: int | None = None,
) -> StockLevel:
    """Apply a signed delta, write the audit row, and fire a low-stock alert if
    this change pushed the level onto/under its threshold. Never blocks."""
    level = _get_level_for_update(db, item_type, item_id)
    previous = level.quantity
    level.quantity = previous + delta
    level.updated_at = utcnow()

    db.add(
        StockAdjustment(
            item_type=item_type,
            item_id=item_id,
            delta=delta,
            reason=reason,
            order_id=order_id,
            adjusted_by=user_id,
            created_at=utcnow(),
        )
    )

    logger.info(
        "stock_change",
        extra={
            "item_type": item_type.value,
            "item_id": item_id,
            "delta": str(delta),
            "previous": str(previous),
            "new": str(level.quantity),
            "order_id": order_id,
            "reason": reason,
        },
    )

    _maybe_low_stock_alert(db, item_type, item_id, previous, level.quantity)
    return level


def _maybe_low_stock_alert(
    db: Session,
    item_type: ItemType,
    item_id: int,
    previous: Decimal,
    current: Decimal,
) -> None:
    threshold = _threshold_for(db, item_type, item_id)
    now_low = current <= threshold
    if not now_low:
        return
    # Only fire on the downward crossing, so a level lingering below threshold
    # doesn't spam an alert on every subsequent sale — unless configured to.
    was_low = previous <= threshold
    if was_low and not get_settings().low_stock_renotify:
        return

    name = _name_for(db, item_type, item_id) or f"{item_type.value} #{item_id}"
    sign = "negative" if current < 0 else "low"
    # Routed through the notifications factory so it hits the same real-time
    # emit hook as every other alert (Phase 4 WebSocket push).
    from app.services import notifications as notif_service

    notif_service.create(
        db,
        type="low_stock",
        message=f"{name} is {sign} (on hand: {current}).",
        related_item_type=item_type,
        related_item_id=item_id,
    )
    logger.info(
        "low_stock_alert",
        extra={"item_type": item_type.value, "item_id": item_id, "on_hand": str(current)},
    )


def deduct_for_order(db: Session, order: Order, user_id: int | None) -> None:
    """Deduct stock for a freshly created order, in the caller's transaction.

    Dual deduction (spec §2B/§2C): every sale *always* deducts the product's own
    finished-goods stock by the units sold, and *additionally* deducts the
    recipe's ingredients (quantity × units sold) when the product has a recipe.
    A product without a recipe therefore only moves its own finished stock. Any
    level may go negative — the sale is never blocked (spec §1).
    """
    for item in order.items:
        product = db.get(Product, item.product_id)

        # 1) always: the product's own finished stock
        apply_delta(
            db,
            item_type=ItemType.product,
            item_id=item.product_id,
            delta=Decimal(-item.quantity),
            reason=f"Sale (order #{order.id})",
            user_id=user_id,
            order_id=order.id,
        )

        # 2) additionally: recipe ingredients, if any
        recipe = product.recipe if product is not None else None
        if recipe is not None and recipe.items:
            for ri in recipe.items:
                apply_delta(
                    db,
                    item_type=ItemType.ingredient,
                    item_id=ri.ingredient_id,
                    delta=-(ri.quantity * item.quantity),
                    reason=f"Sale (order #{order.id})",
                    user_id=user_id,
                    order_id=order.id,
                )


def reverse_for_order(db: Session, order: Order, user_id: int | None) -> None:
    """Restock exactly what a cancelled order deducted, by negating that order's
    prior sale adjustments. Reversing recorded deltas (rather than recomputing
    from the recipe) stays correct even if the recipe changed since the sale."""
    sale_adjustments = db.execute(
        select(StockAdjustment).where(
            StockAdjustment.order_id == order.id,
            StockAdjustment.reason.like("Sale (order #%"),
        )
    ).scalars().all()

    for adj in sale_adjustments:
        apply_delta(
            db,
            item_type=adj.item_type,
            item_id=adj.item_id,
            delta=-adj.delta,  # negate the original deduction → restock
            reason=f"Cancellation reversal (order #{order.id})",
            user_id=user_id,
            order_id=order.id,
        )
