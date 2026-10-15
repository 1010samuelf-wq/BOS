"""Accounts payable/receivable ledger, per company (spec: "Bookkeeping").

A payable company is a supplier we owe; a receivable company is a party that
owes us. Balance is always derived from entries (see Company.balance) — there
is nothing to keep in sync.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from datetime import date

from app.core.errors import APIError, not_found
from app.models import Company, LedgerEntry, User
from app.models.base import utc_today
from app.models.enums import CompanyType, LedgerEntryType
from app.models.misc import Expense
from app.services import trash
from app.schemas.bookkeeping import (
    CompanyCreate,
    CompanyUpdate,
    LedgerEntryCreate,
    LedgerEntryUpdate,
)


def _get_company(db: Session, company_id: int) -> Company:
    company = db.execute(
        select(Company)
        .where(Company.id == company_id)
        .options(selectinload(Company.entries))
    ).scalar_one_or_none()
    if company is None:
        raise not_found(f"Company {company_id} not found")
    return company


def list_companies(db: Session, active_only: bool = True) -> list[Company]:
    stmt = select(Company).options(selectinload(Company.entries)).order_by(Company.name)
    if active_only:
        stmt = stmt.where(Company.active.is_(True))
    return list(db.execute(stmt).scalars().all())


def get_company(db: Session, company_id: int) -> Company:
    return _get_company(db, company_id)


def create_company(db: Session, payload: CompanyCreate) -> Company:
    company = Company(name=payload.name.strip(), type=payload.type)
    db.add(company)
    db.flush()
    return company


def update_company(db: Session, company_id: int, payload: CompanyUpdate) -> Company:
    company = _get_company(db, company_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        company.name = data["name"].strip()
    if "type" in data:
        company.type = data["type"]
    if "active" in data:
        company.active = data["active"]
    return company


def add_entry(db: Session, company_id: int, payload: LedgerEntryCreate, user_id: int | None) -> Company:
    company = _get_company(db, company_id)
    entry = LedgerEntry(
        company_id=company.id,
        entry_date=payload.entry_date,
        type=payload.type,
        amount=payload.amount,
        invoice_number=payload.invoice_number.strip() if payload.invoice_number else None,
        logged_by=user_id,
    )
    db.add(entry)
    db.flush()
    db.refresh(company)
    return company


def update_entry(
    db: Session, company_id: int, entry_id: int, payload: LedgerEntryUpdate
) -> Company:
    """Edit one line in place.

    ``exclude_unset`` matters here for the same reason it does on orders: a
    dump of the whole model would write None over every field the client didn't
    send, quietly blanking an amount while the person thought they were fixing
    the invoice number. An explicit ``invoice_number: null`` still clears it,
    because that key is then present in the payload.
    """
    company = _get_company(db, company_id)
    entry = next((e for e in company.entries if e.id == entry_id), None)
    if entry is None:
        raise not_found(f"Entry {entry_id} not found on company {company_id}")

    data = payload.model_dump(exclude_unset=True)
    if "entry_date" in data and data["entry_date"] is not None:
        entry.entry_date = data["entry_date"]
    if "type" in data and data["type"] is not None:
        entry.type = data["type"]
    if "amount" in data and data["amount"] is not None:
        entry.amount = data["amount"]
    if "invoice_number" in data:
        value = data["invoice_number"]
        # Stored exactly as typed — no padding, no stripping of leading zeros.
        entry.invoice_number = value.strip() if value else None

    db.flush()
    db.refresh(company)
    return company


def delete_entry(
    db: Session, company_id: int, entry_id: int, user: User | None = None
) -> Company:
    company = _get_company(db, company_id)
    entry = next((e for e in company.entries if e.id == entry_id), None)
    if entry is None:
        raise not_found(f"Entry {entry_id} not found on company {company_id}")
    # Mark paid made a matching payment line and an expense. Deleting one half
    # on its own would leave the invoice saying "paid" with no payment, or an
    # expense in Reports for an invoice that's still open — undo does both.
    if entry.paid_on is not None:
        raise APIError(400, "invoice_paid",
                       "This invoice is marked paid. Use \"Undo paid\" first, then delete it.")
    if db.scalar(select(LedgerEntry.id).where(LedgerEntry.payment_entry_id == entry.id)):
        raise APIError(400, "payment_from_mark_paid",
                       "This payment came from \"Mark paid\" on an invoice. Use \"Undo paid\" on that invoice.")

    # Snapshot first, while the row is still here to read.
    trash.record(
        db,
        kind="ledger_entry",
        label=(
            f"{company.name}: {entry.type.value} ${entry.amount} "
            f"on {entry.entry_date.isoformat()}"
            + (f" — invoice {entry.invoice_number}" if entry.invoice_number else "")
        ),
        payload=trash.snapshot(
            entry, ["company_id", "entry_date", "type", "amount", "invoice_number", "logged_by"]
        ),
        user=user,
    )

    db.delete(entry)
    db.flush()
    db.refresh(company)
    return company


# ---- vendor invoices: mark paid / undo ------------------------------------
def _vendor_invoice(db: Session, company_id: int, entry_id: int) -> tuple[Company, LedgerEntry]:
    company = _get_company(db, company_id)
    entry = next((e for e in company.entries if e.id == entry_id), None)
    if entry is None:
        raise not_found(f"Entry {entry_id} not found on company {company_id}")
    if company.type != CompanyType.payable or entry.type != LedgerEntryType.charge:
        # A customer settling up is income, not an expense; and a payment line
        # can't itself be "paid".
        raise APIError(400, "not_a_vendor_invoice", "Only a vendor's invoice can be marked paid.")
    return company, entry


def mark_paid(db: Session, company_id: int, entry_id: int, paid_on: date | None, user: User) -> Company:
    """Pay a vendor invoice in full: a payment line on the ledger, and an
    Expense on the day the money left — which is what puts it in Reports."""
    company, entry = _vendor_invoice(db, company_id, entry_id)
    if entry.paid_on is not None:
        raise APIError(400, "already_paid", f"Already marked paid on {entry.paid_on.isoformat()}.")
    when = paid_on or utc_today()

    payment = LedgerEntry(
        company_id=company.id,
        entry_date=when,
        type=LedgerEntryType.payment,
        amount=entry.amount,
        invoice_number=entry.invoice_number,
        logged_by=user.id,
    )
    expense = Expense(
        description=(f"{company.name} — invoice {entry.invoice_number}" if entry.invoice_number
                     else f"{company.name} — invoice of {entry.entry_date.isoformat()}")[:255],
        amount=entry.amount,
        category="Vendor invoices",
        spent_on=when,
        logged_by=user.id,
    )
    db.add_all([payment, expense])
    db.flush()
    entry.paid_on = when
    entry.payment_entry_id = payment.id
    entry.expense_id = expense.id
    db.flush()
    db.refresh(company)
    return company


def unmark_paid(db: Session, company_id: int, entry_id: int, user: User) -> Company:
    """Take back a Mark paid: the payment line and the expense both go to the
    trash (recorded first, like every delete), and the invoice is open again."""
    company, entry = _vendor_invoice(db, company_id, entry_id)
    if entry.paid_on is None:
        raise APIError(400, "not_paid", "This invoice isn't marked paid.")

    payment = db.get(LedgerEntry, entry.payment_entry_id) if entry.payment_entry_id else None
    expense = db.get(Expense, entry.expense_id) if entry.expense_id else None
    entry.paid_on = None
    entry.payment_entry_id = None
    entry.expense_id = None
    db.flush()

    if payment is not None:
        trash.record(
            db, kind="ledger_entry",
            label=f"{company.name}: payment ${payment.amount} on {payment.entry_date.isoformat()}"
                  + (f" — invoice {payment.invoice_number}" if payment.invoice_number else "")
                  + " (undo of Mark paid)",
            payload=trash.snapshot(payment, ["company_id", "entry_date", "type", "amount", "invoice_number", "logged_by"]),
            user=user,
        )
        db.delete(payment)
    if expense is not None:
        trash.record(
            db, kind="expense",
            label=f"{expense.description} — ${expense.amount} on {expense.spent_on.isoformat()} (undo of Mark paid)",
            payload=trash.snapshot(expense, ["description", "amount", "category", "spent_on", "logged_by"]),
            user=user,
        )
        db.delete(expense)
    db.flush()
    db.refresh(company)
    return company
