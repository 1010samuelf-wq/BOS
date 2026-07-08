"""Order lifecycle (spec §2A, §3, §4).

Transactions: each public function does its work in the caller's session; the
route commits once at the end so stock deduction and the order write land
atomically (spec §1, §2B). On any error the route rolls back.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import bad_request, conflict, not_found
from app.models import (
    FulfillmentStatus,
    FulfillmentType,
    Order,
    OrderItem,
    OrderNote,
    OrderStatus,
    PaidStatus,
    PaymentMethod,
    PaymentTiming,
    Product,
    User,
)
from app.models.base import utcnow
from app.schemas.order import OrderCreate, OrderUpdate
from app.services import stock as stock_service

# How long an edit lock is honoured before it's considered stale (a crashed
# tablet shouldn't wedge an order read-only forever).
LOCK_TTL = timedelta(minutes=5)


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def _fingerprint(payload: OrderCreate) -> str:
    data = payload.model_dump(mode="json", exclude={"idempotency_key"})
    blob = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


def _load(db: Session, order_id: int, *, lock: bool = False) -> Order:
    stmt = (
        select(Order)
        .where(Order.id == order_id)
        .options(selectinload(Order.items), selectinload(Order.notes))
    )
    if lock:
        stmt = stmt.with_for_update()
    order = db.execute(stmt).scalar_one_or_none()
    if order is None:
        raise not_found(f"Order {order_id} not found", code="order_not_found")
    return order


def _build_items(db: Session, payload_items) -> tuple[list[OrderItem], Decimal]:
    items: list[OrderItem] = []
    subtotal = Decimal(0)
    for line in payload_items:
        product = db.get(Product, line.product_id)
        if product is None:
            raise bad_request(
                f"Product {line.product_id} not found", code="unknown_product"
            )
        if not product.active:
            raise bad_request(
                f"Product '{product.name}' is inactive", code="inactive_product"
            )
        line_total = product.price * line.quantity
        subtotal += line_total
        items.append(
            OrderItem(
                product_id=product.id,
                quantity=line.quantity,
                product_name=product.name,
                unit_price=product.price,
                note=line.note,
            )
        )
    return items, subtotal


def _lock_holder(order: Order) -> int | None:
    """Return the user id currently holding a *fresh* edit lock, else None."""
    if order.locked_by is None or order.locked_at is None:
        return None
    locked_at = order.locked_at
    # SQLite drops tzinfo on round-trip; treat a naive value as UTC so the
    # comparison works on both SQLite (tests) and Postgres (prod).
    if locked_at.tzinfo is None:
        locked_at = locked_at.replace(tzinfo=timezone.utc)
    if utcnow() - locked_at > LOCK_TTL:
        return None  # stale → treat as unlocked
    return order.locked_by


# ----------------------------------------------------------------------------
# create (idempotent) + stock deduction
# ----------------------------------------------------------------------------
def create_order(db: Session, payload: OrderCreate, user: User) -> tuple[Order, bool]:
    """Returns (order, created). `created` is False when this was a dedup hit."""
    fingerprint = _fingerprint(payload)

    existing = db.execute(
        select(Order)
        .where(Order.idempotency_key == payload.idempotency_key)
        .options(selectinload(Order.items), selectinload(Order.notes))
    ).scalar_one_or_none()
    if existing is not None:
        if existing.request_fingerprint != fingerprint:
            raise conflict(
                "Idempotency key already used with a different payload.",
                code="idempotency_conflict",
            )
        return existing, False

    items, subtotal = _build_items(db, payload.items)
    delivery = payload.delivery_price or Decimal(0)
    if payload.fulfillment_type != FulfillmentType.delivery:
        delivery = Decimal(0)

    now = utcnow()
    # Card orders are NOT auto-marked paid even when paying "now": the terminal
    # settles separately, so staff confirm and mark them paid manually. Cash /
    # e-transfer paid "now" are settled on the spot.
    pays_now = (
        payload.payment_timing == PaymentTiming.now
        and payload.payment_method != PaymentMethod.card
    )
    order = Order(
        idempotency_key=payload.idempotency_key,
        request_fingerprint=fingerprint,
        client_name=payload.client_name,
        client_phone=payload.client_phone,
        order_date=now,
        needed_for_date=payload.needed_for_date,
        fulfillment_type=payload.fulfillment_type,
        delivery_price=delivery if payload.fulfillment_type == FulfillmentType.delivery else None,
        delivery_address=payload.delivery_address,
        card_message=payload.card_message,
        payment_timing=payload.payment_timing,
        payment_method=payload.payment_method,
        paid_status=PaidStatus.paid if pays_now else PaidStatus.unpaid,
        paid_at=now if pays_now else None,
        paid_by=user.id if pays_now else None,
        status=OrderStatus.pending,
        fulfillment_status=FulfillmentStatus.pending,
        total=subtotal + delivery,
        items=items,
        notes=[
            OrderNote(text=n.text, type=n.type, created_at=now)
            for n in payload.notes
        ],
    )
    db.add(order)
    db.flush()  # assign order.id before writing stock rows tied to it

    stock_service.deduct_for_order(db, order, user_id=user.id)
    return order, True


# ----------------------------------------------------------------------------
# edit lock
# ----------------------------------------------------------------------------
def acquire_lock(db: Session, order_id: int, user: User) -> Order:
    order = _load(db, order_id, lock=True)
    holder = _lock_holder(order)
    if holder is not None and holder != user.id:
        who = db.get(User, holder)
        raise conflict(
            f"Order is currently being edited by {who.name if who else 'another user'}.",
            code="order_locked",
        )
    order.locked_by = user.id
    order.locked_at = utcnow()
    return order


def release_lock(db: Session, order_id: int, user: User) -> Order:
    order = _load(db, order_id, lock=True)
    holder = _lock_holder(order)
    if holder is not None and holder == user.id:
        order.locked_by = None
        order.locked_at = None
    return order


# ----------------------------------------------------------------------------
# update
# ----------------------------------------------------------------------------
def update_order(db: Session, order_id: int, payload: OrderUpdate, user: User) -> Order:
    order = _load(db, order_id, lock=True)
    if order.status == OrderStatus.cancelled:
        raise bad_request("Cancelled orders cannot be edited.", code="order_cancelled")

    holder = _lock_holder(order)
    if holder is not None and holder != user.id:
        who = db.get(User, holder)
        raise conflict(
            f"Order is currently being edited by {who.name if who else 'another user'}.",
            code="order_locked",
        )

    data = payload.model_dump(exclude_unset=True)

    # Item edits re-sync stock: reverse the prior sale deltas, deduct the new
    # set. Keeps stock consistent with "orders are always editable" (spec §7),
    # and stock going negative is fine (spec §1).
    if "items" in data and payload.items is not None:
        stock_service.reverse_for_order(db, order, user_id=user.id)
        order.items.clear()
        db.flush()
        new_items, subtotal = _build_items(db, payload.items)
        order.items = new_items
        delivery = order.delivery_price or Decimal(0)
        order.total = subtotal + delivery
        db.flush()
        stock_service.deduct_for_order(db, order, user_id=user.id)

    for field in (
        "client_name", "client_phone", "needed_for_date",
        "fulfillment_type", "delivery_address", "card_message", "status",
    ):
        if field in data:
            setattr(order, field, data[field])

    if "delivery_price" in data:
        order.delivery_price = data["delivery_price"]
        # Recompute total keeping current line subtotal.
        subtotal = sum((i.unit_price * i.quantity for i in order.items), Decimal(0))
        order.total = subtotal + (order.delivery_price or Decimal(0))

    order.updated_at = utcnow()
    return order


# ----------------------------------------------------------------------------
# cancel / pay / fulfill
# ----------------------------------------------------------------------------
def cancel_order(db: Session, order_id: int, reverse_stock: bool, user: User) -> Order:
    order = _load(db, order_id, lock=True)
    if order.status == OrderStatus.cancelled:
        raise bad_request("Order is already cancelled.", code="already_cancelled")

    if reverse_stock:
        stock_service.reverse_for_order(db, order, user_id=user.id)

    order.status = OrderStatus.cancelled
    order.cancelled_at = utcnow()
    order.cancelled_by = user.id
    order.stock_reversed = reverse_stock
    order.locked_by = None
    order.locked_at = None
    return order


def mark_paid(
    db: Session,
    order_id: int,
    user: User,
    payment_method: PaymentMethod | None = None,
) -> Order:
    order = _load(db, order_id, lock=True)
    if order.paid_status == PaidStatus.paid:
        raise bad_request("Order is already paid.", code="already_paid")
    order.paid_status = PaidStatus.paid
    order.paid_at = utcnow()
    order.paid_by = user.id
    # Record how it was collected (e.g. cash/e-transfer on pickup) so it lands
    # in the right payment-breakdown bucket (spec §2A, §2D).
    if payment_method is not None:
        order.payment_method = payment_method
    return order


def fulfill_order(db: Session, order_id: int, user: User) -> Order:
    order = _load(db, order_id, lock=True)
    if order.status == OrderStatus.cancelled:
        raise bad_request("Cancelled orders cannot be fulfilled.", code="order_cancelled")
    if order.fulfillment_status == FulfillmentStatus.fulfilled:
        raise bad_request("Order is already fulfilled.", code="already_fulfilled")
    order.fulfillment_status = FulfillmentStatus.fulfilled
    order.fulfilled_at = utcnow()
    order.fulfilled_by = user.id
    order.locked_by = None
    order.locked_at = None
    return order


# ----------------------------------------------------------------------------
# notes (spec §2A — persisted, each with a done checkbox)
# ----------------------------------------------------------------------------
def add_note(db: Session, order_id: int, text: str, note_type, user: User) -> Order:
    order = _load(db, order_id)
    order.notes.append(
        OrderNote(text=text, type=note_type, created_at=utcnow())
    )
    db.flush()
    return order


def toggle_note_done(
    db: Session, order_id: int, note_id: int, done: bool | None, user: User
) -> Order:
    order = _load(db, order_id)
    note = next((n for n in order.notes if n.id == note_id), None)
    if note is None:
        raise not_found(f"Note {note_id} not found on order {order_id}", code="note_not_found")
    new_state = (not note.done) if done is None else done
    note.done = new_state
    if new_state:
        note.done_at = utcnow()
        note.done_by = user.id
    else:
        note.done_at = None
        note.done_by = None
    return order


# ----------------------------------------------------------------------------
# read / list
# ----------------------------------------------------------------------------
def get_order(db: Session, order_id: int) -> Order:
    return _load(db, order_id)


def list_orders(
    db: Session,
    *,
    limit: int,
    offset: int,
    status: OrderStatus | None = None,
    paid_status: PaidStatus | None = None,
    fulfillment_type: FulfillmentType | None = None,
    fulfillment_status: FulfillmentStatus | None = None,
    payment_method: PaymentMethod | None = None,
    product_name: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    date_field: str = "order",  # "order" (order_date) or "needed" (needed_for_date)
    exclude_cancelled: bool = False,
) -> tuple[list[Order], int]:
    filters = []
    if status is not None:
        filters.append(Order.status == status)
    if paid_status is not None:
        filters.append(Order.paid_status == paid_status)
    if fulfillment_type is not None:
        filters.append(Order.fulfillment_type == fulfillment_type)
    if fulfillment_status is not None:
        filters.append(Order.fulfillment_status == fulfillment_status)
    if payment_method is not None:
        filters.append(Order.payment_method == payment_method)
    if exclude_cancelled:
        filters.append(Order.status != OrderStatus.cancelled)
    # Date range, interpreted in UTC (matches how the dates are stored) —
    # half-open [from 00:00, to+1 00:00). Targets order_date by default or
    # needed_for_date when date_field="needed" (spec §2A: "order date or
    # needed-for date").
    date_col = Order.needed_for_date if date_field == "needed" else Order.order_date
    if from_date is not None:
        start = datetime(from_date.year, from_date.month, from_date.day, tzinfo=timezone.utc)
        filters.append(date_col >= start)
    if to_date is not None:
        end = datetime(to_date.year, to_date.month, to_date.day, tzinfo=timezone.utc) + timedelta(days=1)
        filters.append(date_col < end)

    base = select(Order)
    if product_name:
        # "find every order containing a given product" (spec §2A).
        base = base.where(
            Order.items.any(OrderItem.product_name.ilike(f"%{product_name}%"))
        )
    if filters:
        base = base.where(*filters)

    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.execute(
        base.order_by(Order.order_date.desc())
        .limit(limit)
        .offset(offset)
        .options(selectinload(Order.items), selectinload(Order.notes))
    ).scalars().all()
    return list(rows), total
