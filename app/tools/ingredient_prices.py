"""Load a supplier price sheet into the ingredient list.

    python -m app.tools.ingredient_prices app/tools/data/<sheet>.csv           # preview
    python -m app.tools.ingredient_prices app/tools/data/<sheet>.csv --apply   # write

Each CSV row is one pack as bought: ``pack_qty pack_unit`` for ``pack_price``,
plus the ``unit`` the price should be expressed per (lb, L, ea, ...).

An ingredient that already exists (same name, ignoring case and spacing) keeps
its own unit and gets its price converted into it. That matters: a recipe's
quantities are in the ingredient's unit, so switching an ingredient priced per
kg to per lb would silently make every recipe that uses it cost 2.2x too much.
When the units can't be converted (a price per lb onto an ingredient counted
per piece), the row is skipped and reported rather than guessed.

Anything not already in the list is added. Nothing is deleted or deactivated.
Without --apply nothing is written; the preview prints the full plan.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Ingredient

# How much of the base unit one of each unit is. Mass in lb, volume in L,
# counted goods in pieces. Spellings people actually type are all here.
_MASS = {
    "lb": Decimal("1"), "lbs": Decimal("1"), "pound": Decimal("1"), "pounds": Decimal("1"),
    "kg": Decimal("2.2046226218"), "g": Decimal("0.0022046226218"),
    "gr": Decimal("0.0022046226218"), "gram": Decimal("0.0022046226218"),
    "grams": Decimal("0.0022046226218"), "oz": Decimal("0.0625"),
}
_VOLUME = {
    "l": Decimal("1"), "liter": Decimal("1"), "litre": Decimal("1"),
    "ml": Decimal("0.001"),
}
_COUNT = {
    "ea": Decimal("1"), "each": Decimal("1"), "unit": Decimal("1"), "units": Decimal("1"),
    "pc": Decimal("1"), "pcs": Decimal("1"), "piece": Decimal("1"), "pieces": Decimal("1"),
}
_FAMILIES = (_MASS, _VOLUME, _COUNT)

_FOUR_PLACES = Decimal("0.0001")  # ingredients.cost_per_unit is Numeric(10, 4)


def _per_unit_factor(from_unit: str, to_unit: str) -> Decimal | None:
    """How many `to_unit` are in one `from_unit`, or None if not comparable.

    Anything outside the known families (pkg, can, box) only converts to itself.
    """
    a, b = from_unit.strip().lower(), to_unit.strip().lower()
    if a == b:
        return Decimal(1)
    for family in _FAMILIES:
        if a in family and b in family:
            return family[a] / family[b]
    return None


def price_per(pack_qty: Decimal, pack_unit: str, pack_price: Decimal, unit: str) -> Decimal | None:
    """Price of one `unit`, given a pack of `pack_qty pack_unit` costing `pack_price`."""
    factor = _per_unit_factor(pack_unit, unit)
    if factor is None or pack_qty <= 0:
        return None
    quantity_in_unit = pack_qty * factor
    return (pack_price / quantity_in_unit).quantize(_FOUR_PLACES, rounding=ROUND_HALF_UP)


def normalise(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip().lower()


@dataclass
class Row:
    name: str
    pack_qty: Decimal
    pack_unit: str
    pack_price: Decimal
    unit: str
    note: str = ""


@dataclass
class Change:
    action: str  # "update" | "add" | "unchanged" | "skip"
    row: Row
    ingredient_id: int | None = None
    unit: str | None = None
    old_price: Decimal | None = None
    new_price: Decimal | None = None
    reason: str = ""


# Sheets that ship with the app, loadable from Settings → Ingredients.
SHEETS_DIR = Path(__file__).resolve().parent / "data"


def read_sheet(path: Path) -> list[Row]:
    with path.open(newline="", encoding="utf-8") as f:
        return [
            Row(
                name=r["name"].strip(),
                pack_qty=Decimal(r["pack_qty"]),
                pack_unit=r["pack_unit"].strip(),
                pack_price=Decimal(r["pack_price"]),
                unit=r["unit"].strip(),
                note=(r.get("note") or "").strip(),
            )
            for r in csv.DictReader(f)
            if r["name"].strip()
        ]


def bundled_sheets() -> list[str]:
    """Names (file stems) of the price sheets shipped in app/tools/data, newest
    first. Only ingredient_prices_* — the folder holds other lists too (the
    product list), and reading one of those as a price sheet would fail."""
    return sorted((p.stem for p in SHEETS_DIR.glob("ingredient_prices_*.csv")), reverse=True)


def bundled_sheet(name: str) -> Path | None:
    """The path for a bundled sheet name, or None. Looked up from the listing
    rather than joined onto the directory, so a name can't climb out of it."""
    return SHEETS_DIR / f"{name}.csv" if name in bundled_sheets() else None


def plan(db: Session, rows: list[Row]) -> list[Change]:
    by_name: dict[str, list[Ingredient]] = {}
    for ing in db.execute(select(Ingredient)).scalars():
        by_name.setdefault(normalise(ing.name), []).append(ing)

    changes: list[Change] = []
    for row in rows:
        matches = by_name.get(normalise(row.name), [])
        if len(matches) > 1:
            changes.append(Change("skip", row, reason=f"{len(matches)} ingredients share this name"))
            continue
        if not matches:
            new = price_per(row.pack_qty, row.pack_unit, row.pack_price, row.unit)
            if new is None:
                changes.append(Change("skip", row, reason=f"can't express {row.pack_unit} per {row.unit}"))
            else:
                changes.append(Change("add", row, unit=row.unit, new_price=new))
            continue

        ing = matches[0]
        new = price_per(row.pack_qty, row.pack_unit, row.pack_price, ing.unit)
        if new is None:
            changes.append(Change(
                "skip", row, ingredient_id=ing.id, unit=ing.unit, old_price=ing.cost_per_unit,
                reason=f"existing ingredient is priced per {ing.unit!r}; sheet is per {row.unit}",
            ))
        elif new == ing.cost_per_unit:
            changes.append(Change("unchanged", row, ing.id, ing.unit, ing.cost_per_unit, new))
        else:
            changes.append(Change("update", row, ing.id, ing.unit, ing.cost_per_unit, new))
    return changes


def apply(db: Session, changes: list[Change]) -> None:
    for c in changes:
        if c.action == "update":
            db.get(Ingredient, c.ingredient_id).cost_per_unit = c.new_price
        elif c.action == "add":
            db.add(Ingredient(name=c.row.name, unit=c.unit, cost_per_unit=c.new_price))
    db.flush()


def report(changes: list[Change], existing: list[Ingredient]) -> str:
    lines = [f"Existing ingredients ({len(existing)}):"]
    for ing in sorted(existing, key=lambda i: normalise(i.name)):
        lines.append(f"  #{ing.id} {ing.name} — ${ing.cost_per_unit}/{ing.unit}"
                     + ("" if ing.active else " (inactive)"))
    for action in ("update", "add", "unchanged", "skip"):
        group = [c for c in changes if c.action == action]
        lines.append(f"\n{action.upper()} ({len(group)}):")
        for c in group:
            if action == "update":
                lines.append(f"  #{c.ingredient_id} {c.row.name}: ${c.old_price} -> ${c.new_price}/{c.unit}")
            elif action == "add":
                lines.append(f"  {c.row.name}: ${c.new_price}/{c.unit}")
            elif action == "unchanged":
                lines.append(f"  #{c.ingredient_id} {c.row.name}: ${c.new_price}/{c.unit}")
            else:
                lines.append(f"  {c.row.name}: {c.reason}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("sheet", type=Path)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: preview)")
    args = parser.parse_args(argv)

    from app.database import SessionLocal

    rows = read_sheet(args.sheet)
    with SessionLocal() as db:
        existing = list(db.execute(select(Ingredient)).scalars())
        changes = plan(db, rows)
        print(report(changes, existing))
        if args.apply:
            apply(db, changes)
            db.commit()
            print("\nAPPLIED.")
        else:
            print("\nPreview only — nothing was written. Re-run with --apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
