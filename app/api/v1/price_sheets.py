"""Ingredient price sheets: preview a supplier sheet against the ingredient
list, then apply it.

The sheets ship with the app (app/tools/data). Same rules as the command-line
tool, because it is the same code: an existing ingredient keeps its unit and
gets the price converted into it, anything unconvertible is skipped, nothing
is deleted. Gated on the settings section, like editing ingredients.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.errors import not_found
from app.core.permissions import require_section
from app.database import get_db
from app.models import User
from app.schemas.price_sheet import PriceChangeOut, PriceImportOut, PriceSheetOut
from app.tools import ingredient_prices as sheets

router = APIRouter(prefix="/price-sheets", tags=["catalog"])


@router.get("", response_model=list[PriceSheetOut])
def list_sheets(_: User = Depends(require_section("settings"))):
    return [
        PriceSheetOut(name=n, rows=len(sheets.read_sheet(sheets.bundled_sheet(n))))
        for n in sheets.bundled_sheets()
    ]


@router.post("/{name}/import", response_model=PriceImportOut)
def import_sheet(
    name: str,
    apply: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    """Preview by default; `?apply=true` writes the updates and additions."""
    path = sheets.bundled_sheet(name)
    if path is None:
        raise not_found(f"Price sheet {name!r} not found")
    changes = sheets.plan(db, sheets.read_sheet(path))
    if apply:
        sheets.apply(db, changes)
        db.commit()
    return PriceImportOut(
        sheet=name,
        applied=apply,
        changes=[
            PriceChangeOut(
                action=c.action,
                name=c.row.name,
                ingredient_id=c.ingredient_id,
                unit=c.unit,
                old_price=c.old_price,
                new_price=c.new_price,
                note=c.row.note,
                reason=c.reason,
            )
            for c in changes
        ],
    )
