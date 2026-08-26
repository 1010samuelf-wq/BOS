"""Request/response shapes for the offline write-queue replay endpoint
(POST /sync/replay). Each *Op schema is the payload shape for one queueable
action — mostly the existing live-endpoint schema plus whatever id the live
endpoint takes from the URL path instead (order_id, note_id, task_id).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import NoteType, PaymentMethod
from app.schemas.order import OrderCreate, OrderUpdate


class OrderCreateOp(OrderCreate):
    pass


class OrderUpdateOp(OrderUpdate):
    order_id: int


class OrderCancelOp(BaseModel):
    order_id: int
    reverse_stock: bool = False


class OrderMarkPaidOp(BaseModel):
    order_id: int
    payment_method: PaymentMethod | None = None


class OrderFulfillOp(BaseModel):
    order_id: int


class OrderAddNoteOp(BaseModel):
    order_id: int
    text: str = Field(min_length=1)
    type: NoteType = NoteType.general


class OrderToggleNoteOp(BaseModel):
    order_id: int
    note_id: int
    done: bool | None = None


class TimeClockOp(BaseModel):
    """clock_in/clock_out act on the acting user — no fields needed."""


class TaskSetDoneOp(BaseModel):
    task_id: int
    # Required (unlike the live endpoint's optional toggle) — a queued action
    # replayed hours later must carry the state the user actually chose, not
    # blind-toggle whatever the server happens to hold by then.
    done: bool


# ---- batch envelope ----
class SyncOpIn(BaseModel):
    client_op_id: str = Field(min_length=8, max_length=64)
    type: str
    acting_user_id: int
    queued_at: datetime | None = None
    payload: dict
    expected_updated_at: datetime | None = None


class SyncReplayIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    operations: list[SyncOpIn]


class SyncOpResult(BaseModel):
    client_op_id: str
    status: str  # applied | already_applied | conflict | rejected
    data: dict | None = None
    current: dict | None = None  # populated on status == "conflict"
    error: dict | None = None  # {code, message}, populated on status in (conflict, rejected)


class SyncReplayOut(BaseModel):
    results: list[SyncOpResult]
