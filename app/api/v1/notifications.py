"""Notification feed (spec §2H). Any authenticated user; the feed is shop-wide.

Reading the feed or the badge count lazily refreshes time-based (overdue)
notifications first, so the list is always current even without a scheduler.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.core.errors import not_found
from app.core.pagination import Page, PageParams
from app.core.permissions import require_section
from app.database import get_db
from app.models import User
from app.schemas.notification import NotificationOut, UnreadCountOut
from app.services import notifications as notif_service

router = APIRouter(
    prefix="/notifications", tags=["notifications"],
    dependencies=[Depends(require_section("notifications"))],
)


@router.get("", response_model=Page[NotificationOut])
def list_notifications(
    page: PageParams = Depends(),
    unread_only: bool = False,
    type: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    notif_service.refresh_overdue(db)
    db.commit()
    rows, total = notif_service.list_notifications(
        db, unread_only=unread_only, type_=type, limit=page.limit, offset=page.offset
    )
    return Page[NotificationOut](items=rows, total=total, limit=page.limit, offset=page.offset)


@router.get("/unread-count", response_model=UnreadCountOut)
def unread_count(
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    notif_service.refresh_overdue(db)
    db.commit()
    return UnreadCountOut(unread=notif_service.unread_count(db))


@router.post("/scan", response_model=UnreadCountOut)
def scan(
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    """Force an overdue scan (for a scheduler/cron). New notifications emit live
    on creation."""
    notif_service.refresh_overdue(db)
    db.commit()
    return UnreadCountOut(unread=notif_service.unread_count(db))


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    n = notif_service.mark_read(db, notification_id)
    if n is None:
        raise not_found(f"Notification {notification_id} not found")
    db.commit()
    db.refresh(n)
    return n


@router.post("/read-all", response_model=UnreadCountOut)
def mark_all_read(
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    notif_service.mark_all_read(db)
    db.commit()
    return UnreadCountOut(unread=notif_service.unread_count(db))
