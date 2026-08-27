"""Staff feedback — a short note sent from any screen of the dashboard or the
tablet app.

Deliberately its own table rather than a Notification row: feedback is written
by people about the software, has no domain object behind it, and is read by
whoever maintains the system, so mixing it into the operational feed would put
it in front of staff who can't act on it.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    false as sa_false,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    # "web" | "tablet" — kept as a plain string, not an enum: a native enum
    # would need a migration to add a future client, and nothing branches on it.
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    # Where the person was when they hit the button (route or screen name).
    # Free-form and best-effort — it's a debugging hint, not a key.
    context: Mapped[str | None] = mapped_column(String(200))
    # Who sent it. Kept nullable so deleting an employee can never destroy the
    # feedback they left.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    handled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa_false(), nullable=False
    )
    handled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
