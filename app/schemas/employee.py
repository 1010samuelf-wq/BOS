from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.permissions import GRANTABLE_SECTIONS
from app.models.enums import UserRole


class EmployeeCreate(BaseModel):
    """Admin creates the record; the employee sets their own PIN on first login
    (spec §2E), so no PIN here."""

    name: str = Field(min_length=1, max_length=120)
    role: UserRole = UserRole.cashier


class EmployeeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: UserRole | None = None
    active: bool | None = None
    # Per-employee section override. [] = access to nothing; null via a separate
    # "reset" flag. Only grantable sections are accepted.
    permissions: list[str] | None = None

    @field_validator("permissions")
    @classmethod
    def _valid_sections(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        bad = [s for s in v if s not in GRANTABLE_SECTIONS]
        if bad:
            raise ValueError(f"Unknown section(s): {', '.join(bad)}")
        return sorted(set(v))


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: UserRole
    active: bool
    pin_set: bool                       # completed first-login PIN setup?
    permissions: list[str] | None       # raw override (null = using role default)
    effective_sections: list[str]       # what they can actually access
    # One-time first-login setup code — returned ONLY by create/reset-pin (the
    # plaintext exists just at issue time); always null in list/update.
    setup_code: str | None = None
