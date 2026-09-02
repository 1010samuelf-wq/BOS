from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import (
    FulfillmentStatus,
    FulfillmentType,
    NoteType,
    OrderStatus,
    PaidStatus,
    PaymentMethod,
    PaymentTiming,
)


# ---- inputs ----
class OrderItemIn(BaseModel):
    # Exactly one of product_id / (custom_name + custom_price) is required —
    # a catalog product, or an ad-hoc item entered for this order (spec: add
    # a custom product+price at order time, optionally keep it as a regular
    # product going forward via save_as_product).
    product_id: int | None = None
    custom_name: str | None = Field(default=None, min_length=1, max_length=200)
    custom_price: Decimal | None = Field(default=None, ge=0)
    save_as_product: bool = False
    quantity: int = Field(gt=0)
    note: str | None = None

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "OrderItemIn":
        has_product = self.product_id is not None
        has_custom = self.custom_name is not None or self.custom_price is not None
        if has_product == has_custom:  # neither, or both — both are wrong
            raise ValueError(
                "Provide either product_id or custom_name + custom_price, not both/neither."
            )
        if has_custom and (not self.custom_name or self.custom_price is None):
            raise ValueError("A custom item needs both custom_name and custom_price.")
        return self


class OrderNoteIn(BaseModel):
    text: str = Field(min_length=1)
    type: NoteType = NoteType.general


class OrderCreate(BaseModel):
    # Client-generated UUID for idempotent submit (spec §2A).
    idempotency_key: str = Field(min_length=8, max_length=64)

    client_name: str = Field(min_length=1, max_length=200)
    client_phone: str | None = None
    needed_for_date: datetime | None = None

    fulfillment_type: FulfillmentType
    delivery_price: Decimal | None = Field(default=None, ge=0)
    delivery_address: str | None = None
    delivery_name: str | None = None
    card_message: str | None = None
    # Who the order is for when the customer is ordering on someone's behalf.
    for_whom: str | None = Field(default=None, max_length=200)

    payment_timing: PaymentTiming
    payment_method: PaymentMethod | None = None
    # What the customer said they'd pay with. Allowed on any order and never
    # required — it's a note about the future, not a claim that money moved,
    # so it deliberately has no cross-field rule that could reject an order at
    # the counter.
    expected_payment_method: PaymentMethod | None = None

    items: list[OrderItemIn] = Field(min_length=1)
    notes: list[OrderNoteIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_consistency(self):
        if self.fulfillment_type == FulfillmentType.delivery and not self.delivery_address:
            raise ValueError("delivery_address is required for delivery orders")
        if self.payment_timing == PaymentTiming.now and self.payment_method is None:
            raise ValueError("payment_method is required when paying now")
        if self.payment_timing == PaymentTiming.later and self.payment_method is not None:
            raise ValueError("payment_method must be omitted for pay-later orders")
        return self


class OrderUpdate(BaseModel):
    """Partial edit of an order. Items/notes, when provided, replace the set.

    Orders are always editable regardless of paid status (spec §7). Editing
    takes the row lock; see the service layer.
    """

    client_name: str | None = Field(default=None, min_length=1, max_length=200)
    client_phone: str | None = None
    needed_for_date: datetime | None = None
    fulfillment_type: FulfillmentType | None = None
    delivery_price: Decimal | None = Field(default=None, ge=0)
    delivery_address: str | None = None
    delivery_name: str | None = None
    card_message: str | None = None
    for_whom: str | None = Field(default=None, max_length=200)
    expected_payment_method: PaymentMethod | None = None
    status: OrderStatus | None = None
    items: list[OrderItemIn] | None = None


class CancelIn(BaseModel):
    # If true, restock ingredients deducted for this order (spec §2A).
    reverse_stock: bool = False


class MarkPaidIn(BaseModel):
    # How a pay-later order was ultimately collected, so it lands in the right
    # payment-breakdown bucket (Cash/Card/E-transfer). Optional for back-compat.
    payment_method: PaymentMethod | None = None


class AddNoteIn(BaseModel):
    text: str = Field(min_length=1)
    type: NoteType = NoteType.general


class NoteDoneIn(BaseModel):
    # Explicit set; omit the body to toggle current state.
    done: bool | None = None


# ---- outputs ----
class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    product_name: str
    quantity: int
    unit_price: Decimal
    note: str | None


class OrderNoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    text: str
    type: NoteType
    done: bool
    done_at: datetime | None
    done_by: int | None
    created_at: datetime


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    idempotency_key: str
    client_name: str
    client_phone: str | None
    order_date: datetime
    needed_for_date: datetime | None
    fulfillment_type: FulfillmentType
    delivery_price: Decimal | None
    delivery_address: str | None
    delivery_name: str | None
    card_message: str | None
    for_whom: str | None
    payment_timing: PaymentTiming
    payment_method: PaymentMethod | None
    expected_payment_method: PaymentMethod | None
    paid_status: PaidStatus
    paid_at: datetime | None
    paid_by: int | None
    status: OrderStatus
    fulfillment_status: FulfillmentStatus
    fulfilled_at: datetime | None
    fulfilled_by: int | None
    cancelled_at: datetime | None
    stock_reversed: bool
    updated_at: datetime
    total: Decimal
    locked_by: int | None
    locked_at: datetime | None
    items: list[OrderItemOut]
    notes: list[OrderNoteOut]
