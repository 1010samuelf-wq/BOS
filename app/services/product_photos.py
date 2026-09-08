"""Managing a product's photos.

One rule holds the whole thing together: **`products.photo_url` always mirrors
the first photo.** Everything here goes through `_resync_cover()` so that stays
true after any add, delete or reorder.

It matters because `photo_url` is what the installed tablet binaries read, and
tablets on the old runtime can no longer be updated over the air. The gallery
is the source of truth; the column is a view of it that old clients can still
understand.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import bad_request, not_found
from app.models import Product, ProductPhoto

# A product's gallery, not an album. Enough for a cake from a few angles;
# bounded so the public menu payload can't grow without limit.
MAX_PHOTOS = 8


def _resync_cover(product: Product) -> None:
    """Renumber positions 0..n and point photo_url at the first."""
    for index, photo in enumerate(sorted(product.photos, key=lambda p: (p.position, p.id))):
        photo.position = index
    ordered = sorted(product.photos, key=lambda p: (p.position, p.id))
    product.photo_url = ordered[0].url if ordered else None


def _product_or_404(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise not_found(f"Product {product_id} not found")
    return product


def add_photo(db: Session, product_id: int, url: str) -> Product:
    product = _product_or_404(db, product_id)
    if len(product.photos) >= MAX_PHOTOS:
        raise bad_request(
            f"A product can have up to {MAX_PHOTOS} photos. Remove one first.",
            code="too_many_photos",
        )
    product.photos.append(ProductPhoto(url=url, position=len(product.photos)))
    db.flush()
    _resync_cover(product)
    db.flush()
    return product


def delete_photo(db: Session, product_id: int, photo_id: int) -> Product:
    product = _product_or_404(db, product_id)
    photo = next((p for p in product.photos if p.id == photo_id), None)
    if photo is None:
        raise not_found(f"Photo {photo_id} not found on product {product_id}")

    product.photos.remove(photo)
    db.flush()
    # Deleting the cover promotes whatever is next rather than leaving the
    # product with no picture while it still has some.
    _resync_cover(product)
    db.flush()
    return product


def make_cover(db: Session, product_id: int, photo_id: int) -> Product:
    """Move one photo to the front — the shot the grid and tablet show."""
    product = _product_or_404(db, product_id)
    photo = next((p for p in product.photos if p.id == photo_id), None)
    if photo is None:
        raise not_found(f"Photo {photo_id} not found on product {product_id}")

    # -1 sorts ahead of everything; _resync_cover then renumbers from zero.
    photo.position = -1
    db.flush()
    _resync_cover(product)
    db.flush()
    return product


def urls_for(db: Session, product_id: int) -> list[str]:
    rows = db.execute(
        select(ProductPhoto)
        .where(ProductPhoto.product_id == product_id)
        .order_by(ProductPhoto.position, ProductPhoto.id)
    ).scalars().all()
    return [r.url for r in rows]
