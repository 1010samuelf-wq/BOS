"""Deleted things (the "Deleted" screen).

Admin-only. The trash spans every section — an admin looking here can see a
ledger line someone in bookkeeping removed and a shift someone in payroll
removed, so gating it on any one section would either leak across sections or
hide half the list.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.database import get_db
from app.models import User
from app.schemas.trash import TrashItemOut
from app.services import trash as service

router = APIRouter(prefix="/trash", tags=["trash"])


def _out(db: Session, item) -> TrashItemOut:
    who = db.get(User, item.deleted_by) if item.deleted_by else None
    return TrashItemOut(
        id=item.id,
        kind=item.kind,
        label=item.label,
        payload=item.payload,
        deleted_by=item.deleted_by,
        deleted_by_name=who.name if who else None,
        deleted_at=item.deleted_at,
        restored_at=item.restored_at,
        restorable=item.kind in service.RESTORABLE and item.restored_at is None,
    )


@router.get("", response_model=list[TrashItemOut])
def list_trash(
    include_restored: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return [_out(db, i) for i in service.list_items(db, include_restored=include_restored)]


@router.post("/{item_id}/restore", response_model=TrashItemOut)
def restore(
    item_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    item = service.restore(db, item_id)
    db.commit()
    db.refresh(item)
    return _out(db, item)
