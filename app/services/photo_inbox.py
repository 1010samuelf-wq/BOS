"""The photo inbox: upload now, decide which product later.

Assigning moves the photo: its URL joins the product's gallery (through
`product_photos.add_photo`, so the cover rule still holds) and the inbox row
goes. That's a move, not a delete — the picture is still in use — so only
*discarding* records to the trash.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import not_found
from app.models import InboxPhoto, Product, User
from app.services import product_photos
from app.services import trash as trash_service


def list_photos(db: Session) -> list[InboxPhoto]:
    # Oldest first: the person sorting works through them in the order taken.
    return list(
        db.execute(select(InboxPhoto).order_by(InboxPhoto.uploaded_at, InboxPhoto.id))
        .scalars()
        .all()
    )


def add(db: Session, *, url: str, filename: str | None, user: User) -> InboxPhoto:
    photo = InboxPhoto(url=url, filename=(filename or None) and filename[:255], uploaded_by=user.id)
    db.add(photo)
    db.flush()
    return photo


def _get(db: Session, photo_id: int) -> InboxPhoto:
    photo = db.get(InboxPhoto, photo_id)
    if photo is None:
        raise not_found(f"Inbox photo {photo_id} not found")
    return photo


def assign(db: Session, photo_id: int, product_id: int) -> Product:
    photo = _get(db, photo_id)
    # add_photo raises before anything changes if the product is missing or
    # its gallery is full, so a refused assignment leaves the photo in the
    # inbox to try somewhere else.
    product = product_photos.add_photo(db, product_id, photo.url)
    db.delete(photo)
    db.flush()
    return product


def discard(db: Session, photo_id: int, user: User) -> None:
    photo = _get(db, photo_id)
    trash_service.record(
        db,
        kind="inbox_photo",
        label=f"Unassigned photo{f' — {photo.filename}' if photo.filename else ''}",
        payload=trash_service.snapshot(photo, ["url", "filename", "uploaded_by", "uploaded_at"]),
        user=user,
    )
    db.delete(photo)
    db.flush()
