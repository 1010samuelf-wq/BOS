from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel

from app.schemas.expense import ExpenseOut


# ---- sales / bookkeeping summary (spec §2D, §11) ----
class PaymentBreakdown(BaseModel):
    cash: Decimal
    card: Decimal
    etransfer: Decimal
    # Paid orders whose method wasn't recorded (e.g. a pay-later order marked
    # paid without a method). Kept explicit rather than silently dropped.
    unspecified: Decimal
    # Booked but not yet collected (pay-later still unpaid).
    unpaid: Decimal


class SalesReportOut(BaseModel):
    from_date: date
    to_date: date
    revenue: Decimal          # booked total of non-cancelled orders
    order_count: int
    ingredient_cost: Decimal  # COGS from recipes on sold items
    expenses_total: Decimal
    profit: Decimal           # revenue - ingredient_cost - expenses_total
    payment_breakdown: PaymentBreakdown
    expenses: list[ExpenseOut]


# ---- production summary / bake list (spec §2D, §11) ----
class ProductionRow(BaseModel):
    product_id: int
    product_name: str
    total_quantity: int       # units needed across matching orders
    order_count: int          # distinct orders contributing
    in_stock: Decimal         # current finished stock on hand
    to_bake: Decimal          # max(0, needed - in_stock)


class ProductionReportOut(BaseModel):
    from_date: date
    to_date: date
    rows: list[ProductionRow]
    total_needed: int
    total_to_bake: Decimal


# ---- deliveries manifest (spec §2A, §11) ----
class DeliveryItem(BaseModel):
    product_name: str
    quantity: int


class DeliveryRow(BaseModel):
    order_id: int
    needed_for_date: datetime | None  # full datetime so delivery times show
    client_name: str
    client_phone: str | None
    delivery_address: str | None
    delivery_name: str | None
    items: list[DeliveryItem]
    box_count: int            # distinct line items, NOT summed quantity (§2A)
    total: Decimal
    paid_status: str


class DeliveriesOut(BaseModel):
    from_date: date
    to_date: date
    rows: list[DeliveryRow]


# ---- all-staff weekly hours (spec §2G admin view) ----
class StaffHoursRow(BaseModel):
    user_id: int
    name: str
    total_hours: float


class HoursReportOut(BaseModel):
    week_start: date
    week_end: date
    rows: list[StaffHoursRow]
    grand_total_hours: float
