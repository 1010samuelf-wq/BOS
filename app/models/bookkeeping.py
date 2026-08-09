"""Bookkeeping: a simple accounts payable/receivable ledger per company.

A Company is either `payable` (a supplier we owe) or `receivable` (a party
that owes us). Its balance is derived — never stored — as the sum of its
`charge` entries minus its `payment` entries, so it's always consistent with
the entries and never needs a reconciliation step.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Enum as SAEnum, ForeignKey, Numeric, String, Text, true as sa_true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.enums import CompanyType, LedgerEntryType


class Company(Base, TimestampMixin):
    __tablename__ = "bookkeeping_companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[CompanyType] = mapped_column(SAEnum(CompanyType, name="bookkeeping_company_type"), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=sa_true(), nullable=False)

    entries: Mapped[list["LedgerEntry"]] = relationship(
        back_populates="company", cascade="all, delete-orphan", order_by="LedgerEntry.entry_date"
    )

    @property
    def balance(self) -> Decimal:
        """Derived, never stored — sum(charges) - sum(payments). Positive means
        money is owed in the direction implied by `type` (we owe them if
        payable, they owe us if receivable)."""
        total = Decimal(0)
        for e in self.entries:
            total += e.amount if e.type == LedgerEntryType.charge else -e.amount
        return total


class LedgerEntry(Base, TimestampMixin):
    __tablename__ = "bookkeeping_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("bookkeeping_companies.id"), nullable=False, index=True)
    company: Mapped["Company"] = relationship(back_populates="entries")

    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    type: Mapped[LedgerEntryType] = mapped_column(SAEnum(LedgerEntryType, name="bookkeeping_entry_type"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    logged_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
