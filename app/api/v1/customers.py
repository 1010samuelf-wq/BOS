"""Customers.

Behind the `orders` section: knowing who ordered is part of taking an order,
and everyone who can take one needs the autocomplete. Editing and merging are
manager+, because a bad merge is not something a cashier should be able to do
mid-rush.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import current_user, require_manager
from app.core.permissions import require_section
from app.database import get_db
from app.models import User
from app.schemas.customer import (
    CustomerCreate,
    ReassignIn,
    CustomerDetailOut,
    CustomerOrderOut,
    CustomerOut,
    CustomerUpdate,
    MergeIn,
)
from app.services import customer as customer_service

router = APIRouter(
    prefix="/customers", tags=["customers"],
    dependencies=[Depends(require_section("orders"))],
)


def _detail(db: Session, customer) -> CustomerDetailOut:
    count, value = customer_service.totals(db, customer.id)
    rows = []
    for o in customer_service.history(db, customer.id):
        rows.append(CustomerOrderOut(
            id=o.id,
            order_date=o.order_date,
            needed_for_date=o.needed_for_date,
            total=o.total,
            status=o.status.value,
            paid_status=o.paid_status.value,
            for_whom=o.for_whom,
            items=", ".join(f"{i.quantity}x {i.product_name}" for i in o.items) or "—",
        ))
    return CustomerDetailOut(
        **CustomerOut.model_validate(customer).model_dump(),
        order_count=count,
        lifetime_value=value,
        orders=rows,
    )


@router.get("", response_model=list[CustomerOut])
def list_customers(
    q: str | None = Query(default=None, description="Name or phone substring."),
    limit: int = Query(default=20, le=50),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    return customer_service.search(db, q, limit)


@router.get("/{customer_id}", response_model=CustomerDetailOut)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    return _detail(db, customer_service.get(db, customer_id))


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(
    payload: CustomerCreate,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    customer = customer_service.create(
        db, payload.name, payload.phone, payload.address, payload.notes
    )
    db.commit()
    db.refresh(customer)
    return customer


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    customer = customer_service.update(
        db, customer_id, payload.model_dump(exclude_unset=True)
    )
    db.commit()
    db.refresh(customer)
    return customer


@router.post("/{customer_id}/merge", response_model=CustomerDetailOut)
def merge_customers(
    customer_id: int,
    payload: MergeIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Fold a duplicate into this customer. Their orders move across."""
    target = customer_service.merge(db, payload.source_id, customer_id)
    db.commit()
    db.refresh(target)
    return _detail(db, target)


@router.post("/{customer_id}/orders", response_model=CustomerDetailOut)
def reassign_order_to_customer(
    customer_id: int,
    payload: ReassignIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Move an order onto this customer — the way to split two people the
    automatic matching folded together."""
    customer_service.reassign_order(db, payload.order_id, customer_id)
    db.commit()
    return _detail(db, customer_service.get(db, customer_id))
