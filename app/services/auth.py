"""Login + first-login PIN setup (spec §2E).

Hardened for internet exposure: first-login PIN setup requires a one-time
admin-issued setup code (so a stranger can't claim an un-onboarded account's
PIN), and repeated failed logins lock an account for a cooldown.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
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
from app.models import LoginAttempt, User, UserRole
from app.models.base import utcnow
from app.schemas.auth import ChangePinIn, LoginIn, SetPinIn, TokenOut, _WhoIn


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


def set_pin(db: Session, payload: SetPinIn, ip: str) -> User:
    """First-login PIN setup. Allowed only while the employee hasn't set one AND
    the caller presents the valid, unexpired setup code the admin issued."""
    user = _find_user(db, payload)
    if user is None:
        raise not_found("Employee not found")
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

    if len(payload.pin) < _min_pin_length(user):
        raise bad_request(
            f"Your PIN needs to be at least {_min_pin_length(user)} digits.",
            code="pin_too_short",
        )

    user.pin_hash = hash_pin(payload.pin)
    user.pin_set = True
    # Consume the code and clear any prior lockout state.
    user.setup_code_hash = None
    user.setup_code_expires_at = None
    user.failed_login_count = 0
    user.failed_login_window_start = None
    user.locked_until = None
    _clear_attempts(db, user)
    # A new PIN retires every session that was opened under the old one.
    user.token_version += 1
    if _is_privileged(user):
        _notify(db, "pin_security", f"{user.name} set a new PIN with a reset code, from {ip}.")
    return user


def _clear_attempts(db: Session, user: User) -> None:
    """Lift every per-address lock for this employee. Reset in place: these
    rows are bookkeeping, and nothing here is ever hard-deleted."""
    db.execute(
        update(LoginAttempt)
        .where(LoginAttempt.user_id == user.id)
        .values(failed_count=0, locked_until=None)
    )


def reset_pin(db: Session, user_id: int, actor: User, ip: str) -> tuple[User, str]:
    """Admin action: clear an employee's PIN, return them to first-login state,
    and issue a fresh setup code (returned so the admin can hand it over)."""
    user = db.get(User, user_id)
    if user is None:
        raise not_found(f"Employee {user_id} not found")
    user.pin_hash = None
    user.pin_set = False
    user.failed_login_count = 0
    user.failed_login_window_start = None
    user.locked_until = None
    _clear_attempts(db, user)
    # The point of a reset is usually that a device went missing, so cut every
    # session this employee currently has rather than waiting for expiry.
    user.token_version += 1
    code = issue_setup_code(user)
    if _is_privileged(user):
        _notify(db, "pin_security", f"{actor.name} reset {user.name}'s PIN, from {ip}.")
    return user, code


def _find_user(db: Session, who: _WhoIn) -> User | None:
    """The employee being signed in, with their row locked FOR UPDATE.

    The lock is the point. Without it, sixty wrong PINs fired at once all read
    the same failure count before any of them wrote it back, and every one got
    checked — the 5-try lockout was only a lockout for people guessing one at a
    time. With it, the attempts queue on this row and each sees the count the
    one before it left. (SQLite ignores the hint; the suite proves it on
    Postgres.)
    """
    stmt = select(User).with_for_update()
    if who.user_id is not None:
        stmt = stmt.where(User.id == who.user_id)
    else:
        # Admins aren't on the public roster, so they type their name. Exact
        # match, ignoring case and spacing; two people with one name can't use
        # this and must be told apart on the roster.
        name = " ".join((who.name or "").split()).lower()
        stmt = stmt.where(func.lower(func.trim(User.name)) == name)
    found = db.execute(stmt.limit(2)).scalars().all()
    return found[0] if len(found) == 1 else None


def _attempts_for(db: Session, user: User, ip: str) -> LoginAttempt:
    row = db.execute(
        select(LoginAttempt)
        .where(LoginAttempt.user_id == user.id, LoginAttempt.ip == ip)
        .with_for_update()
    ).scalar_one_or_none()
    if row is None:
        # Safe from a duplicate insert: the user row is locked, so no other
        # attempt for this employee can be here at the same time.
        row = LoginAttempt(user_id=user.id, ip=ip, failed_count=0)
        db.add(row)
        db.flush()
    return row


@dataclass
class _Checked:
    """A PIN that checked out, and the address row it was checked against."""

    user: User
    attempts: LoginAttempt


def _notify(db: Session, kind: str, message: str) -> None:
    from app.services import notifications as notification_service

    notification_service.create(db, type=kind, message=message)


def _check_pin(db: Session, who: _WhoIn, pin: str, ip: str) -> _Checked:
    """Verify a PIN under the lockout rules; return the employee or raise.

    Two counters. Per (employee, address): five wrong PINs lock that address
    out for that employee — a stranger only locks themselves out. Per employee
    across all addresses, over a rolling window: a higher ceiling for guessing
    spread over many IPs, which never applies to an address that has signed in
    as this employee before, so the shop's own devices keep working through an
    attack. A right PIN clears its own address's count but never the
    employee-wide one, or any address could wipe what the others piled up.

    Does not mark the address as known: only a sign-in that actually issues a
    session does that (`_signed_in`).
    """
    settings = get_settings()
    # Uniform 401 whether the user is missing or the PIN is wrong, so the
    # response doesn't reveal which employee ids exist.
    invalid = APIError(401, "invalid_credentials", "Invalid employee or PIN.")
    locked = APIError(
        403, "account_locked",
        "Too many failed attempts. Try again later or ask an admin to reset.",
    )

    user = _find_user(db, who)
    if user is None or not user.active:
        raise invalid

    now = utcnow()
    attempts = _attempts_for(db, user, ip)
    if attempts.locked_until is not None and now < _aware(attempts.locked_until):
        raise locked
    known = attempts.last_success_at is not None and now - _aware(
        attempts.last_success_at
    ) < timedelta(days=settings.login_known_device_days)
    if not known and user.locked_until is not None and now < _aware(user.locked_until):
        raise locked

    if not user.pin_set:
        raise APIError(
            403, "pin_not_set", "PIN not set yet — complete first-login setup."
        )

    if not verify_pin(pin, user.pin_hash):
        lock_for = timedelta(minutes=settings.login_lockout_minutes)
        attempts.failed_count += 1
        if attempts.failed_count >= settings.login_max_attempts:
            attempts.locked_until = now + lock_for
            attempts.failed_count = 0

        window = timedelta(hours=settings.login_employee_window_hours)
        start = user.failed_login_window_start
        if start is None or now - _aware(start) >= window:
            user.failed_login_count = 0
            user.failed_login_window_start = now
        user.failed_login_count = (user.failed_login_count or 0) + 1
        if user.failed_login_count >= settings.login_max_attempts_per_employee:
            user.locked_until = now + lock_for
            user.failed_login_count = 0
            user.failed_login_window_start = None
            _notify(
                db, "login_attack",
                f"{settings.login_max_attempts_per_employee} wrong PINs were tried for "
                f"{user.name} within {settings.login_employee_window_hours} hours, latest "
                f"from {ip}. New devices can't sign in as {user.name} for "
                f"{settings.login_lockout_minutes} minutes; devices they already use still work.",
            )
        db.commit()
        raise invalid

    # Right PIN: this address's own count is cleared. Not the employee-wide one.
    attempts.failed_count = 0
    attempts.locked_until = None
    return _Checked(user=user, attempts=attempts)


def _signed_in(checked: _Checked) -> None:
    """A session is being issued: from now on this address is a known device."""
    checked.attempts.last_success_at = utcnow()


def _is_privileged(user: User) -> bool:
    return user.role in (UserRole.admin, UserRole.manager)


def _min_pin_length(user: User) -> int:
    settings = get_settings()
    if user.role in (UserRole.admin, UserRole.manager):
        return max(settings.pin_min_length, settings.privileged_pin_min_length)
    return settings.pin_min_length


def _token_for(user: User) -> TokenOut:
    settings = get_settings()
    token = create_access_token(user.id, user.role.value, user.token_version)
    return TokenOut(
        access_token=token,
        expires_in=settings.jwt_expire_minutes * 60,
        user_id=user.id,
        name=user.name,
        role=user.role,
        sections=sorted(effective_sections(user)),
    )


def login(db: Session, payload: LoginIn, ip: str) -> TokenOut:
    checked = _check_pin(db, payload, payload.pin, ip)
    user = checked.user
    # The PIN was right, but an admin's or manager's that predates the 6-digit
    # rule doesn't get a session until it's changed. No session, so this
    # address isn't marked as known. The message is written for tablets that
    # can't yet show the change-PIN screen: they print it.
    if len(payload.pin) < _min_pin_length(user):
        db.commit()
        raise APIError(
            403, "pin_change_required",
            f"Your PIN needs to be at least {_min_pin_length(user)} digits now. "
            "Choose a new one on the dashboard sign-in page, then use it here.",
        )
    _signed_in(checked)
    db.commit()
    return _token_for(user)


def change_pin(db: Session, payload: ChangePinIn, ip: str) -> TokenOut:
    """Replace a PIN, proving the current one. Signs in with the new PIN.
    An admin's or manager's change is announced in the notification feed with
    the address it came from, so a change nobody expected gets noticed."""
    checked = _check_pin(db, payload, payload.current_pin, ip)
    user = checked.user
    if len(payload.new_pin) < _min_pin_length(user):
        db.commit()
        raise bad_request(
            f"Your PIN needs to be at least {_min_pin_length(user)} digits.",
            code="pin_too_short",
        )
    if verify_pin(payload.new_pin, user.pin_hash):
        db.commit()
        raise bad_request("Choose a PIN different from the old one.", code="pin_unchanged")
    user.pin_hash = hash_pin(payload.new_pin)
    # A new PIN retires every session that was opened under the old one.
    user.token_version += 1
    if _is_privileged(user):
        _notify(db, "pin_security", f"{user.name} changed their PIN, from {ip}.")
    _signed_in(checked)
    db.commit()
    return _token_for(user)
