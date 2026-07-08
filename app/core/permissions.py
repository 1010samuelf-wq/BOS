"""Per-employee section access (overrides role defaults).

Each area of the app is a *section*. An employee's effective sections come from
their explicit `permissions` override if set, else their role's defaults. Admins
always have every section (so no one can lock the shop's admin out). The
`employees` section (managing people + permissions) is admin-only and not
grantable — that keeps the privilege-escalation surface closed.

`require_section` / `require_any_section` are FastAPI dependencies applied at the
router or endpoint level; the frontends use `effective_sections` (surfaced on
login and per employee) to show only the allowed nav.
"""

from __future__ import annotations

from fastapi import Depends

from app.core.auth import current_user
from app.core.errors import APIError
from app.models import User, UserRole

# All sections. `employees` is admin-only (not in GRANTABLE).
ALL_SECTIONS: list[str] = [
    "orders",
    "stock",
    "reports",
    "production",
    "deliveries",
    "tasks",
    "notifications",
    "time",
    "settings",
    "employees",
]

# Sections an admin may toggle per employee (everything except employees mgmt).
GRANTABLE_SECTIONS: list[str] = [s for s in ALL_SECTIONS if s != "employees"]

ROLE_DEFAULTS: dict[UserRole, set[str]] = {
    UserRole.cashier: {"orders", "tasks", "notifications", "time"},
    UserRole.manager: {
        "orders", "stock", "reports", "production", "deliveries",
        "tasks", "notifications", "time",
    },
    UserRole.admin: set(ALL_SECTIONS),
}


def effective_sections(user: User) -> set[str]:
    """The sections this employee can actually access."""
    if user.role == UserRole.admin:
        return set(ALL_SECTIONS)  # admins always have everything
    if user.permissions is not None:
        # explicit override — intersect with grantable to ignore stale/invalid keys
        return set(user.permissions) & set(GRANTABLE_SECTIONS)
    return set(ROLE_DEFAULTS.get(user.role, set()))


def require_section(section: str):
    """Dependency: caller must have `section` in their effective sections."""

    def _dep(user: User = Depends(current_user)) -> User:
        if section not in effective_sections(user):
            raise APIError(403, "forbidden", f"No access to the {section} section.")
        return user

    return _dep


def require_any_section(*sections: str):
    """Dependency: caller must have at least one of `sections`."""

    def _dep(user: User = Depends(current_user)) -> User:
        allowed = effective_sections(user)
        if not any(s in allowed for s in sections):
            raise APIError(403, "forbidden", "Insufficient section access.")
        return user

    return _dep
