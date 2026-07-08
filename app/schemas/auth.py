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
    user_id: int
    pin: str

    @field_validator("pin")
    @classmethod
    def _pin(cls, v: str) -> str:
        return _validate_pin(v)


class SetPinIn(BaseModel):
    """First-login PIN setup for a newly added employee (spec §2E)."""

    user_id: int
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
    """Minimal, pre-auth employee info for the shared-device login picker."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: UserRole
    pin_set: bool  # false → route to first-login PIN setup
