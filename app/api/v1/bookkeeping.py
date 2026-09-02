"""Bookkeeping (spec: accounts payable/receivable per company). Gated behind
the `bookkeeping` section — grantable, but not in any role's defaults, so it
has to be explicitly turned on for non-admins (financial data)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.core.permissions import require_section
from app.database import get_db
from app.models import User
from app.schemas.bookkeeping import (
    CompanyCreate,
    CompanyDetailOut,
    CompanyOut,
    CompanyUpdate,
    LedgerEntryCreate,
    LedgerEntryUpdate,
)
from app.services import bookkeeping as service

router = APIRouter(
    prefix="/bookkeeping", tags=["bookkeeping"],
    dependencies=[Depends(require_section("bookkeeping"))],
)


@router.get("/companies", response_model=list[CompanyOut])
def list_companies(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    return service.list_companies(db, active_only=not include_inactive)


@router.post("/companies", response_model=CompanyOut, status_code=201)
def create_company(
    payload: CompanyCreate,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    company = service.create_company(db, payload)
    db.commit()
    db.refresh(company)
    return company


@router.get("/companies/{company_id}", response_model=CompanyDetailOut)
def get_company(
    company_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    return service.get_company(db, company_id)


@router.put("/companies/{company_id}", response_model=CompanyOut)
def update_company(
    company_id: int,
    payload: CompanyUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    company = service.update_company(db, company_id, payload)
    db.commit()
    db.refresh(company)
    return company


@router.post("/companies/{company_id}/entries", response_model=CompanyDetailOut, status_code=201)
def add_entry(
    company_id: int,
    payload: LedgerEntryCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    company = service.add_entry(db, company_id, payload, user_id=user.id)
    db.commit()
    db.refresh(company)
    return company


@router.put("/companies/{company_id}/entries/{entry_id}", response_model=CompanyDetailOut)
def update_entry(
    company_id: int,
    entry_id: int,
    payload: LedgerEntryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    company = service.update_entry(db, company_id, entry_id, payload)
    db.commit()
    db.refresh(company)
    return company


@router.delete("/companies/{company_id}/entries/{entry_id}", response_model=CompanyDetailOut)
def delete_entry(
    company_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    company = service.delete_entry(db, company_id, entry_id, user=user)
    db.commit()
    db.refresh(company)
    return company
