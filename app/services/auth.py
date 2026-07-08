"""Login + first-login PIN setup (spec §2E)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import APIError, bad_request, conflict, not_found
from app.core.permissions import effective_sections
from app.core.security import create_access_token, hash_pin, verify_pin
from app.models import User
from app.schemas.auth import LoginIn, SetPinIn, TokenOut


def set_pin(db: Session, payload: SetPinIn) -> User:
    """First-login PIN setup. Allowed only while the employee hasn't set one;
    re-setting an existing PIN is a 409 (an admin reset flow is out of scope for
    Phase 2)."""
    user = db.get(User, payload.user_id)
    if user is None:
        raise not_found(f"Employee {payload.user_id} not found")
    if not user.active:
        raise bad_request("Employee is inactive.", code="inactive_employee")
    if user.pin_set:
        raise conflict("PIN already set for this employee.", code="pin_already_set")

    user.pin_hash = hash_pin(payload.pin)
    user.pin_set = True
    return user


def reset_pin(db: Session, user_id: int) -> User:
    """Admin action: clear an employee's PIN and return them to first-login
    state, so they set a fresh PIN via /auth/set-pin (spec §2E)."""
    user = db.get(User, user_id)
    if user is None:
        raise not_found(f"Employee {user_id} not found")
    user.pin_hash = None
    user.pin_set = False
    return user


def login(db: Session, payload: LoginIn) -> TokenOut:
    user = db.get(User, payload.user_id)
    # Uniform 401 whether the user is missing or the PIN is wrong, so the
    # response doesn't reveal which employee ids exist.
    invalid = APIError(401, "invalid_credentials", "Invalid employee or PIN.")
    if user is None or not user.active:
        raise invalid
    if not user.pin_set:
        raise APIError(
            403, "pin_not_set", "PIN not set yet — complete first-login setup."
        )
    if not verify_pin(payload.pin, user.pin_hash):
        raise invalid

    token = create_access_token(user.id, user.role.value)
    return TokenOut(
        access_token=token,
        expires_in=get_settings().jwt_expire_minutes * 60,
        user_id=user.id,
        name=user.name,
        role=user.role,
        sections=sorted(effective_sections(user)),
    )
