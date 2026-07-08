"""Login + first-login PIN setup (spec §2E).

Hardened for internet exposure: first-login PIN setup requires a one-time
admin-issued setup code (so a stranger can't claim an un-onboarded account's
PIN), and repeated failed logins lock an account for a cooldown.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import APIError, bad_request, conflict, not_found
from app.core.permissions import effective_sections
from app.core.security import (
    create_access_token,
    generate_setup_code,
    hash_pin,
    verify_pin,
)
from app.models import User
from app.models.base import utcnow
from app.schemas.auth import LoginIn, SetPinIn, TokenOut


def _aware(dt: datetime) -> datetime:
    """Normalise a stored datetime to UTC-aware. Postgres round-trips tz-aware
    values, but SQLite (tests/dev) drops tzinfo — assume UTC in that case."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def issue_setup_code(user: User) -> str:
    """Generate a one-time first-login setup code, store only its hash + expiry
    on the user, and return the plaintext for the admin to hand over. Caller
    commits."""
    code = generate_setup_code()
    user.setup_code_hash = hash_pin(code)
    user.setup_code_expires_at = utcnow() + timedelta(
        hours=get_settings().setup_code_ttl_hours
    )
    return code


def set_pin(db: Session, payload: SetPinIn) -> User:
    """First-login PIN setup. Allowed only while the employee hasn't set one AND
    the caller presents the valid, unexpired setup code the admin issued."""
    user = db.get(User, payload.user_id)
    if user is None:
        raise not_found(f"Employee {payload.user_id} not found")
    if not user.active:
        raise bad_request("Employee is inactive.", code="inactive_employee")
    if user.pin_set:
        raise conflict("PIN already set for this employee.", code="pin_already_set")

    invalid_code = APIError(
        403, "invalid_setup_code", "Invalid or expired setup code."
    )
    if user.setup_code_hash is None or user.setup_code_expires_at is None:
        raise invalid_code
    if utcnow() > _aware(user.setup_code_expires_at):
        raise invalid_code
    if not verify_pin(payload.setup_code, user.setup_code_hash):
        raise invalid_code

    user.pin_hash = hash_pin(payload.pin)
    user.pin_set = True
    # Consume the code and clear any prior lockout state.
    user.setup_code_hash = None
    user.setup_code_expires_at = None
    user.failed_login_count = 0
    user.locked_until = None
    return user


def reset_pin(db: Session, user_id: int) -> tuple[User, str]:
    """Admin action: clear an employee's PIN, return them to first-login state,
    and issue a fresh setup code (returned so the admin can hand it over)."""
    user = db.get(User, user_id)
    if user is None:
        raise not_found(f"Employee {user_id} not found")
    user.pin_hash = None
    user.pin_set = False
    user.failed_login_count = 0
    user.locked_until = None
    code = issue_setup_code(user)
    return user, code


def login(db: Session, payload: LoginIn) -> TokenOut:
    settings = get_settings()
    user = db.get(User, payload.user_id)
    # Uniform 401 whether the user is missing or the PIN is wrong, so the
    # response doesn't reveal which employee ids exist.
    invalid = APIError(401, "invalid_credentials", "Invalid employee or PIN.")
    if user is None or not user.active:
        raise invalid

    now = utcnow()
    if user.locked_until is not None and now < _aware(user.locked_until):
        raise APIError(
            403, "account_locked",
            "Too many failed attempts. Try again later or ask an admin to reset.",
        )

    if not user.pin_set:
        raise APIError(
            403, "pin_not_set", "PIN not set yet — complete first-login setup."
        )

    if not verify_pin(payload.pin, user.pin_hash):
        user.failed_login_count = (user.failed_login_count or 0) + 1
        if user.failed_login_count >= settings.login_max_attempts:
            user.locked_until = now + timedelta(
                minutes=settings.login_lockout_minutes
            )
            user.failed_login_count = 0
        db.commit()
        raise invalid

    # Success — clear any failure/lock state.
    if user.failed_login_count or user.locked_until:
        user.failed_login_count = 0
        user.locked_until = None
        db.commit()

    token = create_access_token(user.id, user.role.value)
    return TokenOut(
        access_token=token,
        expires_in=settings.jwt_expire_minutes * 60,
        user_id=user.id,
        name=user.name,
        role=user.role,
        sections=sorted(effective_sections(user)),
    )
