"""Accounts payable/receivable ledger, per company (spec: "Bookkeeping").

A payable company is a supplier we owe; a receivable company is a party that
owes us. Balance is always derived from entries (see Company.balance) — there
is nothing to keep in sync.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import not_found
from app.models import Company, LedgerEntry
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
        note=payload.note.strip() if payload.note else None,
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
    a note. An explicit ``note: null`` still clears the note, because that key
    is then present in the payload.
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
    if "note" in data:
        note = data["note"]
        entry.note = note.strip() if note else None

    db.flush()
    db.refresh(company)
    return company


def delete_entry(db: Session, company_id: int, entry_id: int) -> Company:
    company = _get_company(db, company_id)
    entry = next((e for e in company.entries if e.id == entry_id), None)
    if entry is None:
        raise not_found(f"Entry {entry_id} not found on company {company_id}")
    db.delete(entry)
    db.flush()
    db.refresh(company)
    return company
