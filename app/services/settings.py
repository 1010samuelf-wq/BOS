"""App-settings singleton access (spec §2I/§4)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import AppSettings
from app.models.base import utcnow

_SINGLETON_ID = 1


def get_settings_row(db: Session) -> AppSettings:
    """Fetch the singleton settings row, creating it on first access."""
    row = db.get(AppSettings, _SINGLETON_ID)
    if row is None:
        row = AppSettings(id=_SINGLETON_ID)
        db.add(row)
        db.flush()
    return row


def update_fields(db: Session, **fields) -> AppSettings:
    row = get_settings_row(db)
    for key, value in fields.items():
        setattr(row, key, value)
    row.updated_at = utcnow()
    return row
