"""Tables owned by later phases — defined now so the schema is complete and no
second migration is needed later (spec §5). No Phase-1 API touches these yet.
"""

from __future__ import annotations

import json
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
    false as sa_false,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.models.enums import ItemType


class Expense(Base, TimestampMixin):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100))
    spent_on: Mapped[date] = mapped_column(Date, nullable=False)
    logged_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class TimeEntry(Base):
    """Clock-in/out timestamps per employee (spec §2G)."""

    __tablename__ = "time_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    clock_in: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    clock_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Payroll: whether this shift has been paid out (spec §2G).
    paid: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa_false(), nullable=False
    )


class DailyReport(Base):
    """Optional materialised daily rollup (spec §2D). Populated in Phase 3."""

    __tablename__ = "daily_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_date: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    revenue: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    order_count: Mapped[int] = mapped_column(default=0, nullable=False)
    ingredient_cost: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=0, nullable=False
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class Notification(Base):
    """Low-stock / overdue feed items (spec §2H). Feed API is a later phase, but
    Phase-1 stock logic already writes low-stock rows here."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(40), nullable=False)  # low_stock/overdue…
    message: Mapped[str] = mapped_column(Text, nullable=False)
    # Loose links to the related entity (kept nullable/soft on purpose).
    related_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"))
    related_task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    related_item_type: Mapped[ItemType | None] = mapped_column(
        SAEnum(ItemType, name="stock_item_type")
    )
    related_item_id: Mapped[int | None] = mapped_column()
    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class Task(Base):
    """Assigned to-dos (spec §2J). API is a later phase."""

    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    assigned_to: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    assigned_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class Inquiry(Base):
    """A customer's public-site product selection (spec: justcakeskosher.com
    menu). Not a real Order — no payment/fulfillment info is collected here;
    staff call the customer back to finalize and place the actual order
    through the normal app flow. `items_json` is a point-in-time snapshot
    (product name + price + qty), so it stays meaningful even if the catalog
    changes later."""

    __tablename__ = "inquiries"

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_name: Mapped[str] = mapped_column(String(200), nullable=False)
    customer_phone: Mapped[str] = mapped_column(String(50), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    items_json: Mapped[str] = mapped_column(Text, nullable=False)
    handled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa_false(), nullable=False
    )
    handled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    @property
    def items(self) -> list[dict]:
        """Parsed view of `items_json` for InquiryOut (schema reads this via
        from_attributes, same shape as InquiryItemOut)."""
        return json.loads(self.items_json)
