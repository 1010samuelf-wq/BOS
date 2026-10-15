"""Product lists: load the baker's item list into the catalog, with the names
and prices edited in Settings → Products first.

The bundled CSV only supplies the starting rows. The import takes the rows
back from the screen, so a nicer name typed in is what gets saved. Preview by
default; `apply: true` writes. Gated on settings, like editing products.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.errors import not_found
from app.core.permissions import require_section
from app.database import get_db
from app.models import User
from app.schemas.product_list import (
    ProductListChangeOut,
    ProductListImportIn,
    ProductListImportOut,
    ProductListOut,
    ProductListRow,
)
from app.tools import product_list as pl

router = APIRouter(prefix="/product-lists", tags=["catalog"])


@router.get("", response_model=list[ProductListOut])
def list_product_lists(_: User = Depends(require_section("settings"))):
    return [ProductListOut(name=n, rows=len(pl.read_list(pl.list_path(n)))) for n in pl.lists()]


@router.get("/{name}", response_model=list[ProductListRow])
def get_product_list(name: str, _: User = Depends(require_section("settings"))):
    path = pl.list_path(name)
    if path is None:
        raise not_found(f"Product list {name!r} not found")
    return [ProductListRow(**r.__dict__) for r in pl.read_list(path)]


@router.post("/import", response_model=ProductListImportOut)
def import_products(
    payload: ProductListImportIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    rows = [pl.Row(**r.model_dump()) for r in payload.rows]
    changes = pl.plan(db, rows)
    if payload.apply:
        pl.apply(db, changes)
        db.commit()
    return ProductListImportOut(
        applied=payload.apply,
        changes=[
            ProductListChangeOut(
                action=c.action,
                name=c.row.name.strip(),
                baker_name=c.row.baker_name,
                product_id=c.product_id,
                old_name=c.old_name,
                old_price=c.old_price,
                new_price=c.new_price,
                reason=c.reason or c.row.note,
            )
            for c in changes
        ],
    )
