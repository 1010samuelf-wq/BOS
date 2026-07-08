"""Orders, line items, notes (spec §2A, §5)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.enums import (
    FulfillmentStatus,
    FulfillmentType,
    NoteType,
    OrderStatus,
    PaidStatus,
    PaymentMethod,
    PaymentTiming,
)


class Order(Base, TimestampMixin):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Idempotency: client-generated UUID; a retried submit returns the first
    # order instead of creating a duplicate (spec §2A, §4).
    idempotency_key: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    # Hash of the create payload. Lets a retried submit with the *same* body
    # return the original order, while the same key with a *different* body is
    # a 409 conflict (spec §4).
    request_fingerprint: Mapped[str | None] = mapped_column(String(64))

    client_name: Mapped[str] = mapped_column(String(200), nullable=False)
    client_phone: Mapped[str | None] = mapped_column(String(40))

    # order_date is server-set at creation; needed_for is the pickup/delivery
    # date and is what drives the overdue flag.
    order_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    needed_for_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    fulfillment_type: Mapped[FulfillmentType] = mapped_column(
        SAEnum(FulfillmentType, name="fulfillment_type"), nullable=False
    )
    delivery_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    delivery_address: Mapped[str | None] = mapped_column(Text)
    card_message: Mapped[str | None] = mapped_column(Text)

    payment_timing: Mapped[PaymentTiming] = mapped_column(
        SAEnum(PaymentTiming, name="payment_timing"), nullable=False
    )
    payment_method: Mapped[PaymentMethod | None] = mapped_column(
        SAEnum(PaymentMethod, name="payment_method")
    )
    paid_status: Mapped[PaidStatus] = mapped_column(
        SAEnum(PaidStatus, name="paid_status"),
        default=PaidStatus.unpaid,
        nullable=False,
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    status: Mapped[OrderStatus] = mapped_column(
        SAEnum(OrderStatus, name="order_status"),
        default=OrderStatus.pending,
        nullable=False,
    )
    fulfillment_status: Mapped[FulfillmentStatus] = mapped_column(
        SAEnum(FulfillmentStatus, name="fulfillment_status"),
        default=FulfillmentStatus.pending,
        nullable=False,
    )
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fulfilled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    # Cancellation bookkeeping: did we restock, so reports can tell true waste
    # from restocked cancellations (spec §5).
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    stock_reversed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Snapshot of the total at submit time (products' price + delivery_price).
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)

    # Row-level edit lock: who holds it and since when (spec §2A).
    locked_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    notes: Mapped[list[OrderNote]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(nullable=False)

    # Snapshots so historical orders keep their original name/price even if the
    # catalog changes later.
    product_name: Mapped[str] = mapped_column(String(200), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)

    order: Mapped[Order] = relationship(back_populates="items")


class OrderNote(Base):
    __tablename__ = "order_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[NoteType] = mapped_column(
        SAEnum(NoteType, name="note_type"), default=NoteType.general, nullable=False
    )
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    order: Mapped[Order] = relationship(back_populates="notes")
