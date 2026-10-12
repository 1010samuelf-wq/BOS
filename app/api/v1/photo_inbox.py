"""Photo inbox: bulk-upload pictures, then match each to a product.

Gated on the settings section, like every other way of changing a product's
photos. Uploads are one file per request; the dashboard sends a batch as a
series of them, so one bad file is reported on its own instead of failing
the rest.
"""

from fastapi import APIRouter, Depends, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permissions import require_section
from app.database import get_db
from app.models import InboxPhoto, User
from app.schemas.catalog import ProductOut
from app.schemas.photo_inbox import AssignIn, InboxPhotoOut
from app.services import photo_inbox
from app.services import photos as photos_service

router = APIRouter(prefix="/photo-inbox", tags=["catalog"])


def _out(db: Session, photos: list[InboxPhoto]) -> list[InboxPhotoOut]:
    ids = {p.uploaded_by for p in photos if p.uploaded_by is not None}
    names = (
        dict(db.execute(select(User.id, User.name).where(User.id.in_(ids))).all()) if ids else {}
    )
    return [
        InboxPhotoOut(
            id=p.id,
            url=p.url,
            filename=p.filename,
            uploaded_by=p.uploaded_by,
            uploaded_by_name=names.get(p.uploaded_by),
            uploaded_at=p.uploaded_at,
        )
        for p in photos
    ]


@router.get("", response_model=list[InboxPhotoOut])
def list_inbox(
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    return _out(db, photo_inbox.list_photos(db))


@router.post("", response_model=InboxPhotoOut, status_code=201)
async def upload_to_inbox(
    file: UploadFile,
    db: Session = Depends(get_db),
    user: User = Depends(require_section("settings")),
):
    """One photo (JPEG/PNG/WEBP, max 5MB) into the inbox, not yet on a product."""
    data = await file.read()
    url = photos_service.upload_inbox_photo(file.content_type or "", data)
    photo = photo_inbox.add(db, url=url, filename=file.filename, user=user)
    db.commit()
    db.refresh(photo)
    return _out(db, [photo])[0]


@router.post("/{photo_id}/assign", response_model=ProductOut)
def assign_photo(
    photo_id: int,
    payload: AssignIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_section("settings")),
):
    """Add the photo to a product's gallery and take it out of the inbox."""
    product = photo_inbox.assign(db, photo_id, payload.product_id)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{photo_id}", status_code=204)
def discard_photo(
    photo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_section("settings")),
):
    """Throw a photo away (blurry, duplicate). Recoverable from Deleted."""
    photo_inbox.discard(db, photo_id, user)
    db.commit()
