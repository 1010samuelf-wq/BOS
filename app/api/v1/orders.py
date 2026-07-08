from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.core.pagination import Page, PageParams
from app.core.permissions import require_section
from app.core.realtime import broadcaster
from app.database import get_db
from app.models import (
    AppSettings,
    FulfillmentStatus,
    FulfillmentType,
    OrderStatus,
    PaidStatus,
    PaymentMethod,
    User,
)
from app.schemas.order import (
    AddNoteIn,
    CancelIn,
    MarkPaidIn,
    NoteDoneIn,
    OrderCreate,
    OrderOut,
    OrderUpdate,
)
from app.services import order as order_service
from app.services import pdf as pdf_service

# Broadcast helpers so both tablets refresh live (spec §2F).
_ORDERS = {"type": "orders_changed"}
_STOCK = {"type": "stock_changed"}

router = APIRouter(
    prefix="/orders", tags=["orders"],
    dependencies=[Depends(require_section("orders"))],
)


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: OrderCreate,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    order, created = order_service.create_order(db, payload, user)
    db.commit()
    db.refresh(order)
    if created:
        broadcaster.publish(_ORDERS)
        broadcaster.publish(_STOCK)  # a new order deducts stock
    # A dedup hit is not a fresh creation → 200, not 201.
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return order


@router.get("", response_model=Page[OrderOut])
def list_orders(
    page: PageParams = Depends(),
    status_: OrderStatus | None = Query(default=None, alias="status"),
    paid_status: PaidStatus | None = None,
    fulfillment_type: FulfillmentType | None = None,
    fulfillment_status: FulfillmentStatus | None = None,
    payment_method: PaymentMethod | None = None,
    product_name: str | None = None,
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    date_field: str = Query(default="order", pattern="^(order|needed)$"),
    exclude_cancelled: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    rows, total = order_service.list_orders(
        db,
        limit=page.limit,
        offset=page.offset,
        status=status_,
        paid_status=paid_status,
        fulfillment_type=fulfillment_type,
        fulfillment_status=fulfillment_status,
        payment_method=payment_method,
        product_name=product_name,
        from_date=from_date,
        to_date=to_date,
        date_field=date_field,
        exclude_cancelled=exclude_cancelled,
    )
    return Page[OrderOut](items=rows, total=total, limit=page.limit, offset=page.offset)


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    return order_service.get_order(db, order_id)


@router.put("/{order_id}", response_model=OrderOut)
def update_order(
    order_id: int,
    payload: OrderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    order = order_service.update_order(db, order_id, payload, user)
    db.commit()
    db.refresh(order)
    broadcaster.publish(_ORDERS)
    broadcaster.publish(_STOCK)  # item edits re-sync stock
    return order


@router.post("/{order_id}/lock", response_model=OrderOut)
def lock_order(
    order_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Open-for-edit: take the row lock so other tablets see read-only (§2A)."""
    order = order_service.acquire_lock(db, order_id, user)
    db.commit()
    db.refresh(order)
    broadcaster.publish(_ORDERS)  # other tablet sees the read-only lock
    return order


@router.post("/{order_id}/release-lock", response_model=OrderOut)
def release_order_lock(
    order_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    order = order_service.release_lock(db, order_id, user)
    db.commit()
    db.refresh(order)
    broadcaster.publish(_ORDERS)
    return order


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel_order(
    order_id: int,
    payload: CancelIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    order = order_service.cancel_order(db, order_id, payload.reverse_stock, user)
    db.commit()
    db.refresh(order)
    broadcaster.publish(_ORDERS)
    if payload.reverse_stock:
        broadcaster.publish(_STOCK)
    return order


@router.post("/{order_id}/mark-paid", response_model=OrderOut)
def mark_paid(
    order_id: int,
    payload: MarkPaidIn | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    method = payload.payment_method if payload else None
    order = order_service.mark_paid(db, order_id, user, payment_method=method)
    db.commit()
    db.refresh(order)
    broadcaster.publish(_ORDERS)
    return order


@router.post("/{order_id}/fulfill", response_model=OrderOut)
def fulfill_order(
    order_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Mark delivered / picked up based on fulfillment_type (spec §2A, §4)."""
    order = order_service.fulfill_order(db, order_id, user)
    db.commit()
    db.refresh(order)
    broadcaster.publish(_ORDERS)
    return order


@router.post("/{order_id}/notes", response_model=OrderOut)
def add_note(
    order_id: int,
    payload: AddNoteIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Add a note to an existing order (spec §2A — notes persist and reopen)."""
    order = order_service.add_note(db, order_id, payload.text, payload.type, user)
    db.commit()
    db.refresh(order)
    broadcaster.publish(_ORDERS)
    return order


@router.post("/{order_id}/notes/{note_id}/done", response_model=OrderOut)
def toggle_note_done(
    order_id: int,
    note_id: int,
    payload: NoteDoneIn | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Check/uncheck an order note (spec §2A — done notes stay, greyed)."""
    order = order_service.toggle_note_done(
        db, order_id, note_id, payload.done if payload else None, user
    )
    db.commit()
    db.refresh(order)
    broadcaster.publish(_ORDERS)
    return order


@router.get("/{order_id}/receipt")
def order_receipt(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    """Render the order as a PDF receipt (spec §2A). The client hands the bytes
    to the tablet's own print/share sheet — there is no server-side printer."""
    order = order_service.get_order(db, order_id)
    profile = db.get(AppSettings, 1)  # business-profile header; None → falls back
    content = pdf_service.render_receipt(order, profile)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="receipt-{order_id}.pdf"'},
    )
