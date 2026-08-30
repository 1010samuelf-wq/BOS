"""Customers.

Until now a customer existed only as free text retyped onto every order, so
"Weiss Catering", "Weiss catering" and "weiss" were three different people as
far as any report was concerned, and nobody could see what someone ordered last
time.

An order still carries `client_name` / `client_phone` as a **snapshot** of what
was typed at the time, exactly as an order item snapshots the product name and
price it was sold at. `customer_id` is an additional link, not a replacement:
correcting a customer's name must never rewrite the history of past orders.
"""

from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, true as sa_true
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


def phone_key(phone: str | None) -> str:
    """Digits only — so "514-272-0105", "(514) 272 0105" and "5142720105"
    are one customer rather than three."""
    return re.sub(r"\D", "", phone or "")


def name_key(name: str | None) -> str:
    """Case- and whitespace-insensitive, for matching only. The display name
    keeps whatever capitalisation the staff actually typed."""
    return " ".join((name or "").split()).casefold()


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    # Kept alongside the order's own delivery address: this is the customer's
    # usual one, offered as a default rather than being the source of truth for
    # any particular delivery.
    address: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=sa_true(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
