from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.core.errors import bad_request
from app.core.permissions import require_section
from app.database import get_db
from app.models import Ingredient, ItemType, Product, StockLevel, User
from app.schemas.stock import StockAdjustIn, StockAdjustmentOut, StockLevelOut
from app.services import stock as stock_service

router = APIRouter(
    prefix="/stock", tags=["stock"],
    dependencies=[Depends(require_section("stock"))],
)


@router.get("", response_model=list[StockLevelOut])
def list_stock(
    item_type: ItemType | None = Query(default=None),
    low_only: bool = Query(default=False, description="only low/negative rows"),
    q: str | None = Query(default=None, description="name search"),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    """Live stock, enriched with name + low flag for the Stock screen (§2B)."""
    rows = db.execute(select(StockLevel)).scalars().all()
    out: list[StockLevelOut] = []
    for level in rows:
        if item_type is not None and level.item_type != item_type:
            continue
        if level.item_type == ItemType.ingredient:
            obj = db.get(Ingredient, level.item_id)
            threshold = obj.low_stock_threshold if obj else Decimal(0)
        else:
            obj = db.get(Product, level.item_id)
            threshold = Decimal(0)
        name = obj.name if obj else None
        if q and (name is None or q.lower() not in name.lower()):
            continue
        is_low = level.quantity <= threshold
        if low_only and not is_low:
            continue
        out.append(
            StockLevelOut(
                item_type=level.item_type,
                item_id=level.item_id,
                quantity=level.quantity,
                updated_at=level.updated_at,
                name=name,
                low_stock_threshold=threshold,
                is_low=is_low,
            )
        )
    return out


@router.post("/adjust", response_model=StockAdjustmentOut)
def adjust_stock(
    payload: StockAdjustIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Manual adjustment / purchase logging with audit (spec §2B).
    Gated by the `stock` section (router-level)."""
    if payload.delta == 0:
        raise bad_request("delta must be non-zero", code="zero_delta")

    target = (
        Ingredient if payload.item_type == ItemType.ingredient else Product
    )
    if db.get(target, payload.item_id) is None:
        raise bad_request(
            f"{payload.item_type.value} {payload.item_id} not found",
            code="unknown_item",
        )

    stock_service.apply_delta(
        db,
        item_type=payload.item_type,
        item_id=payload.item_id,
        delta=payload.delta,
        reason=payload.reason,
        user_id=user.id,
    )
    db.commit()
    from app.core.realtime import broadcaster

    broadcaster.publish({"type": "stock_changed"})
    # Return the audit row we just wrote.
    from app.models import StockAdjustment

    adj = db.execute(
        select(StockAdjustment).order_by(StockAdjustment.id.desc()).limit(1)
    ).scalar_one()
    return adj
