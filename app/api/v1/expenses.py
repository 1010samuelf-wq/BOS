"""Expense logging (spec §2D). Manager+ (bookkeeping is a management task)."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.core.errors import not_found
from app.core.permissions import require_section
from app.database import get_db
from app.models import Expense, User
from app.models.base import utc_today
from app.schemas.expense import ExpenseCreate, ExpenseOut, ExpenseUpdate

router = APIRouter(
    prefix="/expenses", tags=["expenses"],
    dependencies=[Depends(require_section("reports"))],
)


@router.post("", response_model=ExpenseOut, status_code=201)
def create_expense(
    payload: ExpenseCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    expense = Expense(
        description=payload.description,
        amount=payload.amount,
        category=payload.category,
        spent_on=payload.spent_on or utc_today(),
        logged_by=user.id,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense


@router.get("", response_model=list[ExpenseOut])
def list_expenses(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    stmt = select(Expense).order_by(Expense.spent_on.desc(), Expense.id.desc())
    if from_date is not None:
        stmt = stmt.where(Expense.spent_on >= from_date)
    if to_date is not None:
        stmt = stmt.where(Expense.spent_on <= to_date)
    return db.execute(stmt).scalars().all()


@router.put("/{expense_id}", response_model=ExpenseOut)
def update_expense(
    expense_id: int,
    payload: ExpenseUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise not_found(f"Expense {expense_id} not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(expense, k, v)
    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/{expense_id}", status_code=204)
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    expense = db.get(Expense, expense_id)
    if expense is None:
        raise not_found(f"Expense {expense_id} not found")
    db.delete(expense)
    db.commit()
