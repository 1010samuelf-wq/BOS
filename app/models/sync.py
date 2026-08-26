"""Offline-sync idempotency/audit log (spec: bakery-floor offline mode).

One row per queued action a tablet has ever replayed, keyed on the client-
generated `client_op_id`. Mirrors the dedup pattern `orders.idempotency_key`
already uses (see app/services/order.py), generalized to every queueable op
type instead of order-creation only.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SyncedOperation(Base):
    __tablename__ = "synced_operations"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_op_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    device_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    op_type: Mapped[str] = mapped_column(String(60), nullable=False)
    acting_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    # Hash of the op's payload — same role as Order.request_fingerprint: a
    # replayed client_op_id with the *same* payload is a safe no-op dedup hit,
    # a different payload under the same id is a client bug worth rejecting.
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # applied|conflict|rejected
    result_json: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(60))
    error_message: Mapped[str | None] = mapped_column(Text)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applied_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
