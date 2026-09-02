"""Deleted things, kept.

Nothing in the shop is hard-deleted any more. Every delete first writes a
snapshot here — what it was, a line of text describing it, and the full row as
JSON — so a mistaken delete is recoverable and an argument about what was on
an invoice has an answer.

The snapshot is deliberately a JSON blob rather than foreign keys back to the
original tables. The row it describes is *gone*; a foreign key would either
block the delete or dangle. Storing the values means the record survives the
thing it describes, which is the entire point.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class TrashItem(Base):
    __tablename__ = "trash_items"

    id: Mapped[int] = mapped_column(primary_key=True)

    # What kind of thing this was: "ledger_entry", "order", "expense",
    # "time_entry", "customer". Drives whether restore is offered.
    kind: Mapped[str] = mapped_column(String(40), nullable=False, index=True)

    # A human line for the list — "Sysco Foods: charge $420.50 on 15 Jul 2026".
    # Written at delete time because the data to build it is about to vanish.
    label: Mapped[str] = mapped_column(Text, nullable=False)

    # The row as it was, enough to put it back.
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)

    deleted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )
    # Set once put back, so the list can show it without losing the history
    # that it was deleted at all.
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
