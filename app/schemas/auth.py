from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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


class _WhoIn(BaseModel):
    """Who is signing in: the roster id, or the name typed in. One of the two
    is required."""

    user_id: int | None = None
    name: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _one_of(self):
        if self.user_id is None and not (self.name or "").strip():
            raise ValueError("user_id or name is required")
        return self


class LoginIn(_WhoIn):
    # Login only verifies against the stored hash — it must NOT enforce the
    # current PIN-length policy, or raising the minimum would lock out everyone
    # whose (valid) PIN predates the change. Just cap the input size.
    pin: str = Field(min_length=1, max_length=64)


class ChangePinIn(_WhoIn):
    """Swap a PIN that no longer meets the policy for one that does. Needs the
    current PIN, so it is the same guess-counted check as logging in."""

    current_pin: str = Field(min_length=1, max_length=64)
    new_pin: str

    @field_validator("new_pin")
    @classmethod
    def _pin(cls, v: str) -> str:
        return _validate_pin(v)


class SetPinIn(_WhoIn):
    """First-login PIN setup for a newly added employee (spec §2E). Requires the
    one-time `setup_code` the admin issued, so a stranger can't claim the PIN of
    a not-yet-onboarded account."""

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
    login screen discovers first-login state reactively via the 403 on login.

    No real role either: it told anyone on the internet which names are the
    managers worth guessing. `role` is kept as the constant "staff" only because
    tablets already in the shop render `roleLabel(e.role)`, which throws on a
    missing value — dropping the key would crash their login screen until an OTA
    reaches them. Current clients don't read it.
    """

    id: int
    name: str
    role: str = "staff"


class StaffEntry(BaseModel):
    """Everyone active, admins included, for pickers inside the app (assigning
    a task, entering someone's hours). Signed-in only."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
