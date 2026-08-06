"""Public menu (justcakeskosher.com) + staff-side inquiry inbox.

The public router has *no* auth dependency — it's the whole point (a customer
browsing the menu isn't a BOS user). It only ever reads active products/the
business phone number and creates an Inquiry; it can't touch orders, stock, or
anything else. This never creates a real Order — the customer calls the
bakery to finalize (not the other way around).
"""

import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import bad_request, not_found
from app.core.permissions import require_section
from app.core.auth import current_user
from app.database import get_db
from app.models import AppSettings, Inquiry, Product, User
from app.models.base import utcnow
from app.schemas.catalog import PublicProductOut, merge_categories
from app.schemas.inquiry import InquiryCreate, InquiryOut, PublicContactOut

public_router = APIRouter(prefix="/public", tags=["public"])
router = APIRouter(
    prefix="/inquiries", tags=["inquiries"],
    dependencies=[Depends(require_section("orders"))],
)


# ---- public (no auth) --------------------------------------------------
@public_router.get("/products", response_model=list[PublicProductOut])
def public_products(category: str | None = Query(default=None), db: Session = Depends(get_db)):
    stmt = select(Product).where(Product.active.is_(True))
    if category is not None:
        stmt = stmt.where(Product.category == category)
    stmt = stmt.order_by(Product.name)
    return db.execute(stmt).scalars().all()


@public_router.get("/categories", response_model=list[str])
def public_categories(db: Session = Depends(get_db)):
    """Filter tabs for the menu: presets plus any category staff have created,
    so a new one shows up publicly without a code change."""
    rows = db.execute(
        select(Product.category)
        .distinct()
        .where(Product.active.is_(True), Product.category.is_not(None))
    ).scalars().all()
    return merge_categories(rows)


@public_router.get("/contact", response_model=PublicContactOut)
def public_contact(db: Session = Depends(get_db)):
    """Business name/phone for the menu site's "call us to finalize" screen."""
    settings = db.get(AppSettings, 1)
    return PublicContactOut(
        business_name=settings.business_name if settings else None,
        business_phone=settings.business_phone if settings else None,
    )


@public_router.post("/inquiries", response_model=InquiryOut, status_code=201)
def create_inquiry(payload: InquiryCreate, db: Session = Depends(get_db)):
    items_out = []
    for line in payload.items:
        product = db.get(Product, line.product_id)
        if product is None or not product.active:
            raise bad_request(
                f"Product {line.product_id} is not available.", code="unknown_product"
            )
        items_out.append({
            "product_id": product.id,
            "product_name": product.name,
            "unit_price": str(product.price),
            "quantity": line.quantity,
        })

    inquiry = Inquiry(
        customer_name=payload.customer_name.strip(),
        customer_phone=payload.customer_phone.strip(),
        note=payload.note.strip() if payload.note else None,
        items_json=json.dumps(items_out),
        created_at=utcnow(),
    )
    db.add(inquiry)
    db.commit()
    db.refresh(inquiry)

    from app.core.realtime import broadcaster

    broadcaster.publish({"type": "inquiry_created"})
    return inquiry


# ---- staff inbox (Manager+, same section as Orders) ---------------------
@router.get("", response_model=list[InquiryOut])
def list_inquiries(
    handled: bool | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    stmt = select(Inquiry).order_by(Inquiry.created_at.desc())
    if handled is not None:
        stmt = stmt.where(Inquiry.handled == handled)
    return db.execute(stmt).scalars().all()


@router.post("/{inquiry_id}/handled", response_model=InquiryOut)
def set_handled(
    inquiry_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    inquiry = db.get(Inquiry, inquiry_id)
    if inquiry is None:
        raise not_found(f"Inquiry {inquiry_id} not found")
    inquiry.handled = not inquiry.handled
    inquiry.handled_by = user.id if inquiry.handled else None
    inquiry.handled_at = utcnow() if inquiry.handled else None
    db.commit()
    db.refresh(inquiry)
    return inquiry
