"""Employees / users (spec §2E, §2G, §5).

PIN is a hash the employee sets on first login; Admin only creates the record
with name + role. `pin_set` tracks whether first-login setup is done. Phase 2
wires the actual PIN/JWT flow; the columns already exist here.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON
from sqlalchemy import DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin
from app.models.enums import UserRole


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, name="user_role"), default=UserRole.cashier, nullable=False
    )
    pin_hash: Mapped[str | None] = mapped_column(String(255))
    pin_set: Mapped[bool] = mapped_column(default=False, nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    # Per-employee section override (list of section keys). NULL → use the role's
    # defaults (see app/core/permissions.py). Admin ignores this (always all).
    permissions: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # First-login gating: an admin issues a one-time setup code (only its hash is
    # stored) that the employee must present to /auth/set-pin. Closes the public
    # set-pin account-takeover window (see app/services/auth.py).
    setup_code_hash: Mapped[str | None] = mapped_column(String(255))
    setup_code_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )

    # Brute-force lockout: consecutive failed logins and, once tripped, the time
    # until which login is refused.
    failed_login_count: Mapped[int] = mapped_column(default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
