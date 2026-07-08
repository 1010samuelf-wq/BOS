"""Singleton app settings: business profile (spec §2I, §4).

One row (id=1), fetched get-or-create by the settings service. Backs the
receipt / delivery-manifest header. (No printer config — receipts are exported
as PDF and printed from the tablet's own print/share tool.)
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)  # always 1 (singleton)

    # Business profile (receipt / manifest header)
    business_name: Mapped[str | None] = mapped_column(String(200))
    business_address: Mapped[str | None] = mapped_column(String(400))
    business_phone: Mapped[str | None] = mapped_column(String(40))

    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
