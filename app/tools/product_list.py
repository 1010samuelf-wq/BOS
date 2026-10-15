"""Load a product list (the baker's handwritten item list, typed up) into the
catalog, with the names and prices a person has edited first.

The CSV in app/tools/data is only the starting point: Settings → Products shows
every row with an editable name and price, and what gets saved is what the
person sent back. So `plan` and `apply` work on rows passed in, not on the file.

A row matches an existing product by either its new name or the baker's name
(ignoring case and spacing). A match is renamed/re-priced rather than added
again, so importing twice — or after typing the baker's name in by hand — never
makes duplicates. New products are sellable at once (active) but kept off the
public website (show_on_menu False) until someone has looked at them and added
a photo. Nothing is deleted or deactivated.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Product
from app.tools.ingredient_prices import normalise

LISTS_DIR = Path(__file__).resolve().parent / "data"
_PREFIX = "products_"


@dataclass
class Row:
    name: str
    baker_name: str
    price: str
    category: str | None
    note: str = ""
    include: bool = True


@dataclass
class Change:
    action: str  # "add" | "update" | "unchanged" | "skip" | "excluded"
    row: Row
    product_id: int | None = None
    old_name: str | None = None
    old_price: Decimal | None = None
    new_price: Decimal | None = None
    reason: str = ""


def lists() -> list[str]:
    """Names (file stems) of the bundled product lists, newest first."""
    return sorted((p.stem for p in LISTS_DIR.glob(f"{_PREFIX}*.csv")), reverse=True)


def list_path(name: str) -> Path | None:
    """Looked up from the listing, never joined onto the directory, so a name
    can't climb out of it."""
    return LISTS_DIR / f"{name}.csv" if name in lists() else None


def read_list(path: Path) -> list[Row]:
    with path.open(newline="", encoding="utf-8") as f:
        return [
            Row(
                name=r["name"].strip(),
                baker_name=(r.get("baker_name") or "").strip(),
                price=r["price"].strip(),
                category=(r.get("category") or "").strip() or None,
                note=(r.get("note") or "").strip(),
            )
            for r in csv.DictReader(f)
            if r["name"].strip()
        ]


def _price(text: str) -> Decimal | None:
    try:
        value = Decimal(text.strip().lstrip("$"))
    except (InvalidOperation, AttributeError):
        return None
    if not value.is_finite() or value < 0 or value >= Decimal("100000000"):
        return None
    return value.quantize(Decimal("0.01"))


def plan(db: Session, rows: list[Row]) -> list[Change]:
    by_name: dict[str, list[Product]] = {}
    for p in db.execute(select(Product)).scalars():
        by_name.setdefault(normalise(p.name), []).append(p)

    # Two rows given the same name would save as two identical-looking
    # products; flag every one of them rather than silently picking one.
    counts: dict[str, int] = {}
    for r in rows:
        if r.include and r.name.strip():
            counts[normalise(r.name)] = counts.get(normalise(r.name), 0) + 1

    changes: list[Change] = []
    for row in rows:
        if not row.include:
            changes.append(Change("excluded", row))
            continue
        name = row.name.strip()
        price = _price(row.price)
        if not name:
            changes.append(Change("skip", row, reason="needs a name"))
            continue
        if len(name) > 200:
            changes.append(Change("skip", row, reason="name is longer than 200 characters"))
            continue
        if price is None:
            changes.append(Change("skip", row, reason="needs a price, e.g. 48 or 5.50"))
            continue
        if counts.get(normalise(name), 0) > 1:
            changes.append(Change("skip", row, reason="two rows have this name"))
            continue

        # The new name wins if it's already in the catalog; otherwise the
        # baker's name finds a product typed in before it had a nicer one.
        matches = by_name.get(normalise(name)) or (
            by_name.get(normalise(row.baker_name)) if row.baker_name else None
        ) or []
        if len(matches) > 1:
            changes.append(Change("skip", row, reason=f"{len(matches)} products already share this name"))
            continue
        if not matches:
            changes.append(Change("add", row, new_price=price))
            continue

        p = matches[0]
        if p.name == name and p.price == price:
            changes.append(Change("unchanged", row, p.id, p.name, p.price, price))
        else:
            changes.append(Change("update", row, p.id, p.name, p.price, price))
    return changes


def apply(db: Session, changes: list[Change]) -> None:
    for c in changes:
        if c.action == "add":
            db.add(Product(
                name=c.row.name.strip(),
                price=c.new_price,
                category=c.row.category,
                active=True,
                show_on_menu=False,
            ))
        elif c.action == "update":
            p = db.get(Product, c.product_id)
            p.name = c.row.name.strip()
            p.price = c.new_price
    db.flush()
