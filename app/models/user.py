"""Employees / users (spec §2E, §2G, §5).

PIN is a hash the employee sets on first login; Admin only creates the record
with name + role. `pin_set` tracks whether first-login setup is done. Phase 2
wires the actual PIN/JWT flow; the columns already exist here.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON
from sqlalchemy import DateTime
from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Integer, Numeric, String, UniqueConstraint
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
    # Payroll pay rate per hour, used to total unpaid time entries (§2G).
    hourly_rate: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=0, server_default="0", nullable=False
    )
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
    # until which login is refused. server_default so a fresh create_all builds a
    # DB default — 0001's raw system-user seed omits this column.
    # Bumped whenever every existing session for this employee must stop
    # working — a PIN reset, a new PIN, or an explicit sign-out-everywhere.
    # Tokens carry the value they were minted with; a mismatch is rejected.
    # server_default is required: 0001 seeds the system admin with raw SQL.
    token_version: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    failed_login_count: Mapped[int] = mapped_column(
        default=0, server_default="0", nullable=False
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Start of the window `failed_login_count` is counting in (the employee-wide
    # ceiling). A right PIN does not reset that count — it would let one
    # address wipe what others had piled up — so it ages out instead.
    failed_login_window_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )


class LoginAttempt(Base):
    """Failed-PIN bookkeeping per employee *per address*.

    The lockout used to live on the employee alone, so anyone who could reach
    the login page could type five wrong PINs for a name on the roster and keep
    that person locked out all day — from the other side of the world. Counting
    per (employee, IP) means a stranger only locks *themselves* out; the shop's
    own connection keeps working.

    `last_success_at` marks an address as a known device for that employee. The
    employee-wide ceiling (`User.failed_login_count`, for guessing spread over
    many addresses) never blocks a known device, so a distributed attacker can't
    lock staff out from the shop either.

    Rows are reset in place, never deleted.
    """

    __tablename__ = "login_attempts"
    __table_args__ = (UniqueConstraint("user_id", "ip", name="uq_login_attempts_user_ip"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    ip: Mapped[str] = mapped_column(String(64), nullable=False)
    failed_count: Mapped[int] = mapped_column(default=0, server_default="0", nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
