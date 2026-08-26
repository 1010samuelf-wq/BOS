"""Generic dispatch for the tablet's offline write queue (spec: bakery-floor
offline mode). `POST /sync/replay` processes a batch of queued actions
through this registry instead of instrumenting every mutating endpoint
individually — each entry wraps an existing, unmodified service function.

Only actions needed for offline floor work are registered (orders, clock
in/out, checking off a task) — admin/back-office actions (settings,
employees, bookkeeping) stay online-only and were never queued client-side.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import APIError
from app.core.permissions import effective_sections
from app.core.realtime import broadcaster
from app.models import SyncedOperation, Task, User, UserRole
from app.schemas.order import OrderOut, OrderUpdate
from app.schemas.sync import (
    OrderAddNoteOp,
    OrderCancelOp,
    OrderCreateOp,
    OrderFulfillOp,
    OrderMarkPaidOp,
    OrderToggleNoteOp,
    OrderUpdateOp,
    SyncOpIn,
    SyncOpResult,
    TaskSetDoneOp,
    TimeClockOp,
)
from app.schemas.task import TaskOut
from app.schemas.time import TimeEntryOut
from app.services import order as order_service
from app.services import tasks as task_service
from app.services import time_tracking


def _fingerprint(payload: dict) -> str:
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


@dataclass
class OpDef:
    section: str
    schema: type[BaseModel]
    response_schema: type[BaseModel]
    # (db, acting_user, validated_payload, expected_updated_at) -> domain object
    handler: Callable[[Session, User, BaseModel, datetime | None], Any]


# ---- handlers: each just calls the existing, unmodified service function ----
def _h_orders_create(db: Session, user: User, p: OrderCreateOp, _expected: datetime | None):
    order, _created = order_service.create_order(db, p, user)
    return order


def _h_orders_update(db: Session, user: User, p: OrderUpdateOp, expected: datetime | None):
    # exclude_unset matters here: update_order only touches fields the client
    # actually sent (payload.model_dump(exclude_unset=True)) — dumping every
    # field (including untouched ones as None) would blank out the rest of
    # the order.
    data = OrderUpdate(**p.model_dump(exclude={"order_id"}, exclude_unset=True))
    return order_service.update_order(db, p.order_id, data, user, expected_updated_at=expected)


def _h_orders_cancel(db: Session, user: User, p: OrderCancelOp, _expected: datetime | None):
    return order_service.cancel_order(db, p.order_id, p.reverse_stock, user)


def _h_orders_mark_paid(db: Session, user: User, p: OrderMarkPaidOp, _expected: datetime | None):
    return order_service.mark_paid(db, p.order_id, user, payment_method=p.payment_method)


def _h_orders_fulfill(db: Session, user: User, p: OrderFulfillOp, _expected: datetime | None):
    return order_service.fulfill_order(db, p.order_id, user)


def _h_orders_add_note(db: Session, user: User, p: OrderAddNoteOp, _expected: datetime | None):
    return order_service.add_note(db, p.order_id, p.text, p.type, user)


def _h_orders_toggle_note(db: Session, user: User, p: OrderToggleNoteOp, _expected: datetime | None):
    return order_service.toggle_note_done(db, p.order_id, p.note_id, p.done, user)


def _h_time_clock_in(db: Session, user: User, _p: TimeClockOp, _expected: datetime | None):
    return time_tracking.clock_in(db, user)


def _h_time_clock_out(db: Session, user: User, _p: TimeClockOp, _expected: datetime | None):
    return time_tracking.clock_out(db, user)


def _h_tasks_set_done(db: Session, user: User, p: TaskSetDoneOp, _expected: datetime | None):
    # Mirrors the route-level check in app/api/v1/tasks.py:set_done — dispatch
    # calls the service directly, bypassing that route, so the check is
    # duplicated here rather than left unenforced.
    task = db.get(Task, p.task_id)
    if task is None:
        raise APIError(404, "not_found", f"Task {p.task_id} not found")
    if task.assigned_to != user.id and user.role not in (UserRole.manager, UserRole.admin):
        raise APIError(403, "forbidden", "You can only complete your own tasks.")
    return task_service.set_done(db, p.task_id, user, p.done)


REGISTRY: dict[str, OpDef] = {
    "orders.create": OpDef("orders", OrderCreateOp, OrderOut, _h_orders_create),
    "orders.update": OpDef("orders", OrderUpdateOp, OrderOut, _h_orders_update),
    "orders.cancel": OpDef("orders", OrderCancelOp, OrderOut, _h_orders_cancel),
    "orders.mark_paid": OpDef("orders", OrderMarkPaidOp, OrderOut, _h_orders_mark_paid),
    "orders.fulfill": OpDef("orders", OrderFulfillOp, OrderOut, _h_orders_fulfill),
    "orders.add_note": OpDef("orders", OrderAddNoteOp, OrderOut, _h_orders_add_note),
    "orders.toggle_note_done": OpDef("orders", OrderToggleNoteOp, OrderOut, _h_orders_toggle_note),
    "time.clock_in": OpDef("time", TimeClockOp, TimeEntryOut, _h_time_clock_in),
    "time.clock_out": OpDef("time", TimeClockOp, TimeEntryOut, _h_time_clock_out),
    "tasks.set_done": OpDef("tasks", TaskSetDoneOp, TaskOut, _h_tasks_set_done),
}


def _record(
    db: Session,
    op: SyncOpIn,
    device_id: str,
    fingerprint: str,
    status: str,
    *,
    result: dict | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> SyncOpResult:
    db.add(
        SyncedOperation(
            client_op_id=op.client_op_id,
            device_id=device_id,
            op_type=op.type,
            acting_user_id=op.acting_user_id,
            request_fingerprint=fingerprint,
            status=status,
            result_json=json.dumps(result) if result is not None else None,
            error_code=error_code,
            error_message=error_message,
            queued_at=op.queued_at,
        )
    )
    db.commit()
    error = {"code": error_code, "message": error_message} if error_code else None
    return SyncOpResult(
        client_op_id=op.client_op_id,
        status=status,
        data=result if status in ("applied", "already_applied") else None,
        current=result if status == "conflict" else None,
        error=error,
    )


# Which op types nudge the *other* tablet on success, mirroring what each
# live route already publishes (app/api/v1/orders.py) — time/task ops publish
# nothing today, so dispatch doesn't invent an event for them either.
_ORDERS = {"type": "orders_changed"}
_STOCK = {"type": "stock_changed"}
_ALWAYS_STOCK_OPS = {"orders.create", "orders.update"}  # always touch stock


def _broadcast_on_success(op_type: str, payload_obj: BaseModel) -> None:
    if not op_type.startswith("orders."):
        return
    broadcaster.publish(_ORDERS)
    if op_type in _ALWAYS_STOCK_OPS:
        broadcaster.publish(_STOCK)
    elif op_type == "orders.cancel" and getattr(payload_obj, "reverse_stock", False):
        broadcaster.publish(_STOCK)


def replay_one(db: Session, device_id: str, op: SyncOpIn) -> SyncOpResult:
    fingerprint = _fingerprint(op.payload)

    existing = db.execute(
        select(SyncedOperation).where(SyncedOperation.client_op_id == op.client_op_id)
    ).scalar_one_or_none()
    if existing is not None:
        if existing.request_fingerprint != fingerprint:
            return SyncOpResult(
                client_op_id=op.client_op_id,
                status="rejected",
                error={"code": "idempotency_conflict", "message": "This action was already synced with different data."},
            )
        if existing.status == "applied":
            return SyncOpResult(
                client_op_id=op.client_op_id,
                status="already_applied",
                data=json.loads(existing.result_json) if existing.result_json else None,
            )
        # A prior conflict/rejected attempt isn't a terminal state — fall
        # through and let the client retry it for real (e.g. after resolving
        # a conflict, or once the actor is active again).

    defn = REGISTRY.get(op.type)
    if defn is None:
        return _record(db, op, device_id, fingerprint, "rejected",
                        error_code="unknown_op_type", error_message=f"Unknown operation type '{op.type}'.")

    actor = db.get(User, op.acting_user_id)
    if actor is None or not actor.active:
        return _record(db, op, device_id, fingerprint, "rejected",
                        error_code="actor_inactive", error_message="Acting user no longer exists or is inactive.")

    if defn.section not in effective_sections(actor):
        return _record(db, op, device_id, fingerprint, "rejected",
                        error_code="forbidden", error_message=f"No access to the {defn.section} section.")

    try:
        payload_obj = defn.schema.model_validate(op.payload)
    except ValidationError as e:
        return _record(db, op, device_id, fingerprint, "rejected",
                        error_code="validation_error", error_message=str(e))

    try:
        result_obj = defn.handler(db, actor, payload_obj, op.expected_updated_at)
        out = defn.response_schema.model_validate(result_obj).model_dump(mode="json")
        # Domain write + audit row commit together — a crash between the two
        # would otherwise let a retried client_op_id silently re-apply.
        db.add(
            SyncedOperation(
                client_op_id=op.client_op_id,
                device_id=device_id,
                op_type=op.type,
                acting_user_id=op.acting_user_id,
                request_fingerprint=fingerprint,
                status="applied",
                result_json=json.dumps(out),
                queued_at=op.queued_at,
            )
        )
        db.commit()
        _broadcast_on_success(op.type, payload_obj)
        return SyncOpResult(client_op_id=op.client_op_id, status="applied", data=out)
    except APIError as e:
        db.rollback()
        if e.code == "stale_version":
            # Re-fetch post-rollback so the conflict payload reflects the true
            # committed state, not anything touched by the failed attempt.
            current = order_service.get_order(db, payload_obj.order_id)  # type: ignore[attr-defined]
            current_out = OrderOut.model_validate(current).model_dump(mode="json")
            return _record(db, op, device_id, fingerprint, "conflict",
                            result=current_out, error_code=e.code, error_message=e.message)
        return _record(db, op, device_id, fingerprint, "rejected",
                        error_code=e.code, error_message=e.message)


def replay_batch(db: Session, device_id: str, operations: list[SyncOpIn]) -> list[SyncOpResult]:
    # Strictly in order — the client appends to its outbox in the order
    # actions happened, so a later op (e.g. an edit) can depend on an earlier
    # one (e.g. the create) having landed first. One failure doesn't stop the
    # batch: each op commits/rolls back independently (see replay_one).
    return [replay_one(db, device_id, op) for op in operations]
