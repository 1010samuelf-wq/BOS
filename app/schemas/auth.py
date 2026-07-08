from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import get_settings
from app.models.enums import UserRole

_s = get_settings()


def _validate_pin(v: str) -> str:
    if not (_s.pin_min_length <= len(v) <= _s.pin_max_length):
        raise ValueError(
            f"PIN must be {_s.pin_min_length}-{_s.pin_max_length} digits"
        )
    if not v.isdigit():
        raise ValueError("PIN must be numeric")
    return v


class LoginIn(BaseModel):
    # Login only verifies against the stored hash — it must NOT enforce the
    # current PIN-length policy, or raising the minimum would lock out everyone
    # whose (valid) PIN predates the change. Just cap the input size.
    user_id: int
    pin: str = Field(min_length=1, max_length=64)


class SetPinIn(BaseModel):
    """First-login PIN setup for a newly added employee (spec §2E). Requires the
    one-time `setup_code` the admin issued, so a stranger can't claim the PIN of
    a not-yet-onboarded account."""

    user_id: int
    setup_code: str = Field(min_length=1, max_length=64)
    pin: str

    @field_validator("pin")
    @classmethod
    def _pin(cls, v: str) -> str:
        return _validate_pin(v)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds
    user_id: int
    name: str
    role: UserRole
    sections: list[str]  # effective sections this employee can access


class RosterEntry(BaseModel):
    """Minimal, pre-auth employee info for the shared-device login picker. No
    `pin_set` — whether an account is onboarded isn't the public's business; the
    login screen discovers first-login state reactively via the 403 on login."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: UserRole
