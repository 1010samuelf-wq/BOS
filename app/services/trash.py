"""Recording and restoring deleted things.

Two halves, and they are deliberately asymmetric:

* ``record()`` is called before *every* delete in the app. It always works,
  for every kind, because losing the record is the failure this whole module
  exists to prevent.
* ``restore()`` only handles kinds that can be put back safely. A ledger entry
  or an expense is a standalone row and goes straight back. An order is not —
  it carries items, stock movements and payment state, and re-inserting one
  would double-count stock. For those the snapshot is kept and readable, and
  restore refuses rather than doing something half-right with the shop's
  numbers.

Nothing here deletes from the trash. That is the one place a hard delete would
defeat the point.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import APIError, not_found
from app.models import Company, LedgerEntry, TrashItem, User
from app.models.base import utcnow
from app.models.enums import LedgerEntryType
from app.models.misc import Expense, TimeEntry

# Kinds that restore() knows how to put back. Everything else is kept and
# readable but has to be re-entered by hand.
RESTORABLE = {"ledger_entry", "expense", "time_entry"}


def _plain(value: Any) -> Any:
    """JSON-safe copy of a column value, without losing precision.

    Money goes to a string, not a float: round-tripping Decimal("420.50")
    through a float and back is how a restored entry ends up a cent off.
    """
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "value"):  # enum
        return value.value
    return value


def snapshot(obj: Any, fields: list[str]) -> dict:
    return {f: _plain(getattr(obj, f)) for f in fields}


def record(
    db: Session,
    *,
    kind: str,
    label: str,
    payload: dict,
    user: User | None = None,
) -> TrashItem:
    """Write the snapshot. Call this *before* the delete, while the row exists."""
    item = TrashItem(
        kind=kind,
        label=label,
        payload=payload,
        deleted_by=user.id if user else None,
    )
    db.add(item)
    db.flush()
    return item


def list_items(db: Session, *, include_restored: bool = False, limit: int = 200) -> list[TrashItem]:
    stmt = select(TrashItem).order_by(TrashItem.deleted_at.desc(), TrashItem.id.desc())
    if not include_restored:
        stmt = stmt.where(TrashItem.restored_at.is_(None))
    return list(db.execute(stmt.limit(limit)).scalars().all())


def get(db: Session, item_id: int) -> TrashItem:
    item = db.get(TrashItem, item_id)
    if item is None:
        raise not_found(f"Trash item {item_id} not found")
    return item


def restore(db: Session, item_id: int) -> TrashItem:
    """Put a deleted row back, when the kind allows it."""
    item = get(db, item_id)
    if item.restored_at is not None:
        raise APIError(400, "already_restored", "That has already been put back.")
    if item.kind not in RESTORABLE:
        raise APIError(
            400, "not_restorable",
            f"A deleted {item.kind.replace('_', ' ')} can't be put back automatically — "
            "the details are kept here so it can be re-entered.",
        )

    data = item.payload
    if item.kind == "ledger_entry":
        # The company has to still exist; restoring a line onto a company that
        # was itself removed would resurrect half a relationship.
        company = db.get(Company, int(data["company_id"]))
        if company is None:
            raise APIError(400, "not_restorable", "That company is no longer on the books.")
        db.add(LedgerEntry(
            company_id=company.id,
            entry_date=date.fromisoformat(data["entry_date"]),
            type=LedgerEntryType(data["type"]),
            amount=Decimal(data["amount"]),
            note=data.get("note"),
            logged_by=data.get("logged_by"),
        ))
    elif item.kind == "expense":
        db.add(Expense(
            description=data["description"],
            amount=Decimal(data["amount"]),
            category=data.get("category"),
            spent_on=date.fromisoformat(data["spent_on"]),
            logged_by=data.get("logged_by"),
        ))
    elif item.kind == "time_entry":
        db.add(TimeEntry(
            user_id=int(data["user_id"]),
            clock_in=datetime.fromisoformat(data["clock_in"]),
            clock_out=datetime.fromisoformat(data["clock_out"]) if data.get("clock_out") else None,
            paid=bool(data.get("paid", False)),
        ))

    item.restored_at = utcnow()
    db.flush()
    return item
