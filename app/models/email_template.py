"""Saved product-email templates.

A template is the whole email: the wording *and* the selection. The shop sends
the same few emails repeatedly — a holiday selection, a wholesale list — and
re-ticking fifteen products each time is the tedious part, so the product ids
are stored with it.

Ids, not a snapshot of names and prices: the point of reopening a template is
to send *today's* catalog, with current prices and whatever photos have been
added since. A product that has since been deleted simply drops out.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    subject: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    # Shown above the products; the sign-off goes below them.
    intro: Mapped[str | None] = mapped_column(Text)
    signoff: Mapped[str | None] = mapped_column(Text)

    product_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
