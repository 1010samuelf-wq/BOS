"""Photos waiting to be matched to a product.

Taking the pictures and knowing which product each one is are often two
different people's jobs: someone photographs a tray of cakes, someone else
who knows the catalog sorts them. An inbox photo is already in object storage;
assigning it just moves its URL into that product's gallery, so nothing is
uploaded twice.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class InboxPhoto(Base):
    __tablename__ = "photo_inbox"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    # The file's own name, which is often the only hint of what's in it.
    filename: Mapped[str | None] = mapped_column(String(255))
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
