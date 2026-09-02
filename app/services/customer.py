"""Customer records: search, history, and keeping duplicates from creeping back.

The backfill in migration 0018 de-duplicated what already existed. This module
is what stops the problem returning: every order resolves to a customer through
`resolve_for_order`, which matches on phone first and name second rather than
creating a fresh record for every spelling.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import APIError, not_found
from app.models import Customer, Order
from app.models.enums import OrderStatus, PaidStatus
from app.models.base import utcnow
from app.models.customer import name_key, phone_key


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = " ".join(value.split())
    return collapsed or None


def search(db: Session, q: str | None, limit: int = 20) -> list[Customer]:
    """Name or phone substring, for the new-order autocomplete.

    Phone matching ignores punctuation, so typing 5142720105 finds a customer
    stored as (514) 272-0105.
    """
    stmt = select(Customer).where(Customer.active.is_(True))
    term = (q or "").strip()
    if term:
        digits = phone_key(term)
        conditions = [Customer.name.ilike(f"%{term}%")]
        if digits:
            # Strip punctuation from the stored value too, so the comparison is
            # digits-to-digits rather than format-to-format.
            normalized = Customer.phone
            for ch in ("-", " ", "(", ")", ".", "+"):
                normalized = func.replace(normalized, ch, "")
            conditions.append(normalized.ilike(f"%{digits}%"))
        stmt = stmt.where(or_(*conditions))
    return list(
        db.execute(stmt.order_by(Customer.name).limit(min(limit, 50))).scalars().all()
    )


def get(db: Session, customer_id: int) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise not_found(f"Customer {customer_id} not found")
    return customer


def history(db: Session, customer_id: int, limit: int = 50) -> list[Order]:
    return list(
        db.execute(
            select(Order)
            .where(Order.customer_id == customer_id)
            .order_by(Order.order_date.desc(), Order.id.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )


def totals(db: Session, customer_id: int) -> tuple[int, Decimal]:
    """Order count and lifetime spend.

    Cash-basis like every other money figure here: only paid orders count, and
    cancelled ones never do.
    """
    row = db.execute(
        select(func.count(Order.id), func.coalesce(func.sum(Order.total), 0)).where(
            Order.customer_id == customer_id,
            Order.status != OrderStatus.cancelled,
            Order.paid_status == PaidStatus.paid,
        )
    ).one()
    # Quantised so the API always emits "0.00" rather than a bare "0" when the
    # sum comes back as an integer zero.
    return int(row[0]), Decimal(str(row[1] or 0)).quantize(Decimal("0.01"))


def find_match(db: Session, name: str | None, phone: str | None) -> Customer | None:
    """Who is this order for? Phone first, name second — with one subtlety.

    A phone number is effectively unique in a shop this size, so a phone hit is
    definitive. What matters is the *miss*: if this order carries a phone and no
    customer has it, a same-name customer who has a **different** phone on file
    is a different person, and matching them would file the order under a
    stranger. Two Sara Kleins with two numbers must stay two Sara Kleins.

    A same-name customer with **no** phone on file is a different case — quite
    possibly the same person, for whom we now finally have a number.
    """
    everyone = list(
        db.execute(select(Customer).where(Customer.active.is_(True))).scalars()
    )
    digits = phone_key(phone)

    if digits:
        for candidate in everyone:
            if phone_key(candidate.phone) == digits:
                return candidate

    key = name_key(name)
    if not key:
        return None

    matches = [c for c in everyone if name_key(c.name) == key]
    if digits:
        # Contradicting numbers means a different person; only fold into a
        # record that has no number to contradict.
        matches = [c for c in matches if not phone_key(c.phone)]

    # Only when unambiguous. Two candidates means we cannot tell which, and a
    # spurious duplicate is recoverable where a misfiled order is not.
    return matches[0] if len(matches) == 1 else None


def resolve_for_order(
    db: Session, name: str, phone: str | None, address: str | None = None
) -> Customer:
    """Find the customer this order belongs to, or create them.

    Called on every order creation, which is what keeps the customer list from
    drifting back into free text.
    """
    existing = find_match(db, name, phone)
    if existing is not None:
        # Fill in details we didn't have before, but never overwrite one the
        # customer record already carries — the record is the considered value,
        # a single order is just one data point.
        if not existing.phone and _clean(phone):
            existing.phone = _clean(phone)
        if not existing.address and _clean(address):
            existing.address = _clean(address)
        existing.updated_at = utcnow()
        return existing

    customer = Customer(
        name=_clean(name) or "Unknown",
        phone=_clean(phone),
        address=_clean(address),
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(customer)
    db.flush()
    return customer


def create(db: Session, name: str, phone: str | None, address: str | None,
           notes: str | None) -> Customer:
    customer = Customer(
        name=_clean(name) or "Unknown",
        phone=_clean(phone),
        address=_clean(address),
        notes=notes,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(customer)
    db.flush()
    return customer


def update(db: Session, customer_id: int, fields: dict) -> Customer:
    customer = get(db, customer_id)
    for key, value in fields.items():
        setattr(customer, key, _clean(value) if key in {"name", "phone", "address"} else value)
    customer.updated_at = utcnow()
    db.flush()
    return customer


def merge(db: Session, source_id: int, target_id: int) -> Customer:
    """Fold one customer into another, moving their orders across.

    The cleanup path for duplicates the automatic matching could not resolve —
    two records for one person because the name was spelled differently and
    neither order carried a phone.
    """
    if source_id == target_id:
        raise APIError(400, "bad_request", "A customer cannot be merged into itself.")
    source = get(db, source_id)
    target = get(db, target_id)

    db.execute(
        Order.__table__.update()
        .where(Order.customer_id == source.id)
        .values(customer_id=target.id)
    )
    # Keep anything the surviving record was missing rather than losing it.
    if not target.phone and source.phone:
        target.phone = source.phone
    if not target.address and source.address:
        target.address = source.address
    if source.notes:
        target.notes = f"{target.notes}\n{source.notes}".strip() if target.notes else source.notes
    target.updated_at = utcnow()

    # Kept for the record, not restorable: the orders have already been moved
    # onto the surviving customer, so putting this row back would create a
    # second empty record rather than undoing anything.
    from app.services import trash

    trash.record(
        db,
        kind="customer",
        label=f'Merged "{source.name}" into "{target.name}"',
        payload=trash.snapshot(source, ["name", "phone", "address", "notes"])
        | {"merged_into": target.id},
    )

    db.delete(source)
    db.flush()
    return target


def reassign_order(db: Session, order_id: int, customer_id: int) -> Order:
    """Move one order to a different customer.

    The undo for a wrong automatic match. Matching folds two orders together
    when they share a phone, which is right for a party planner ordering under
    different names but wrong for two people sharing a household line — and
    `merge` only combines records, it cannot separate them again. This can.

    The order's own client_name / client_phone are left untouched: they are the
    snapshot of what was typed at the time, and correcting who an order belongs
    to is not a licence to rewrite what it said.
    """
    order = db.get(Order, order_id)
    if order is None:
        raise not_found(f"Order {order_id} not found")
    get(db, customer_id)  # 404s if the destination doesn't exist
    order.customer_id = customer_id
    db.flush()
    return order
