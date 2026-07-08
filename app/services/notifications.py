"""Notification feed + generation (spec §2H).

Two sources of notifications:
  1. Low/negative stock — written inline by the stock service the moment a level
     crosses its threshold (see app/services/stock.py).
  2. Overdue orders / tasks — time-based, so they can't be written "at the
     moment of the event". `refresh_overdue` scans for newly-overdue orders and
     tasks and creates one notification each (deduped by related id + type, so a
     given order/task never nags twice). It's called lazily whenever the feed or
     badge count is read, and can also be driven by a scheduler via
     POST /notifications/scan.

Real-time delivery (WebSocket banner/toast + sound on both tablets, §2F/§2H)
attaches in Phase 4: `_emit` is the single hook where every newly created
notification is announced. For now it's a structured log line; Phase 4 swaps the
body for a WebSocket broadcast without touching call sites.
"""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    FulfillmentStatus,
    Notification,
    Order,
    OrderStatus,
    Task,
)
from app.models.base import utcnow

logger = logging.getLogger("bos.notifications")


def emit(notification: Notification) -> None:
    """Announce a freshly created notification: log it and push it live to every
    connected tablet over the WebSocket (banner/toast + sound, spec §2H)."""
    logger.info(
        "notification",
        extra={
            "notif_type": notification.type,
            "notif_message": notification.message,
            "related_order_id": notification.related_order_id,
            "related_task_id": notification.related_task_id,
        },
    )
    # Import locally to avoid a hard import cycle at module load.
    from app.core.realtime import broadcaster

    broadcaster.publish(
        {
            "type": "notification",
            "notification": {
                "type": notification.type,
                "message": notification.message,
                "related_order_id": notification.related_order_id,
                "related_task_id": notification.related_task_id,
                "related_item_type": (
                    notification.related_item_type.value
                    if notification.related_item_type
                    else None
                ),
                "related_item_id": notification.related_item_id,
            },
        }
    )


def create(db: Session, **fields) -> Notification:
    """Create + announce a notification. Central factory so nothing bypasses the
    real-time hook."""
    notification = Notification(created_at=utcnow(), **fields)
    db.add(notification)
    db.flush()
    emit(notification)
    return notification


def refresh_overdue(db: Session) -> int:
    """Create notifications for newly-overdue orders and tasks. Returns how many
    were created. Idempotent — an order/task with an existing overdue
    notification is skipped."""
    now = utcnow()
    created = 0

    # --- overdue orders: needed-for date passed, still active & not fulfilled ---
    overdue_orders = db.execute(
        select(Order).where(
            Order.needed_for_date.is_not(None),
            Order.needed_for_date < now,
            Order.status != OrderStatus.cancelled,
            Order.fulfillment_status != FulfillmentStatus.fulfilled,
        )
    ).scalars().all()

    already = set(
        db.execute(
            select(Notification.related_order_id).where(
                Notification.type == "overdue_order",
                Notification.related_order_id.is_not(None),
            )
        ).scalars().all()
    )
    for order in overdue_orders:
        if order.id in already:
            continue
        create(
            db,
            type="overdue_order",
            message=(
                f"Order #{order.id} for {order.client_name} is overdue "
                f"({order.fulfillment_type.value})."
            ),
            related_order_id=order.id,
        )
        created += 1

    # --- overdue tasks: due date passed, not done ---
    overdue_tasks = db.execute(
        select(Task).where(
            Task.due_date.is_not(None),
            Task.due_date < now,
            Task.done.is_(False),
        )
    ).scalars().all()

    already_tasks = set(
        db.execute(
            select(Notification.related_task_id).where(
                Notification.type == "overdue_task",
                Notification.related_task_id.is_not(None),
            )
        ).scalars().all()
    )
    for task in overdue_tasks:
        if task.id in already_tasks:
            continue
        create(
            db,
            type="overdue_task",
            message=f"Task '{task.description[:60]}' is overdue.",
            related_task_id=task.id,
        )
        created += 1

    return created


def list_notifications(
    db: Session,
    *,
    unread_only: bool = False,
    type_: str | None = None,
    limit: int,
    offset: int,
) -> tuple[list[Notification], int]:
    stmt = select(Notification)
    if unread_only:
        stmt = stmt.where(Notification.read.is_(False))
    if type_:
        stmt = stmt.where(Notification.type == type_)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
        .offset(offset)
    ).scalars().all()
    return list(rows), total


def unread_count(db: Session) -> int:
    return db.scalar(
        select(func.count()).select_from(Notification).where(Notification.read.is_(False))
    ) or 0


def mark_read(db: Session, notification_id: int) -> Notification | None:
    n = db.get(Notification, notification_id)
    if n is None:
        return None
    n.read = True
    return n


def mark_all_read(db: Session) -> int:
    rows = db.execute(
        select(Notification).where(Notification.read.is_(False))
    ).scalars().all()
    for n in rows:
        n.read = True
    return len(rows)
