"""Request authentication + role gating (spec §2E, §6).

Every protected route resolves the acting user from a ``Authorization: Bearer
<jwt>`` header. Roles are ordered cashier < manager < admin; endpoints declare a
minimum with ``require_min_role`` (admin passes every check).
"""

from __future__ import annotations

import jwt
from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.core.errors import APIError
from app.core.security import decode_access_token
from app.database import get_db
from app.models import User, UserRole

_ROLE_ORDER = {UserRole.cashier: 1, UserRole.manager: 2, UserRole.admin: 3}


def current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise APIError(401, "unauthorized", "Missing or malformed bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise APIError(401, "token_expired", "Session token has expired.")
    except jwt.PyJWTError:
        raise APIError(401, "unauthorized", "Invalid session token.")

    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError, TypeError):
        raise APIError(401, "unauthorized", "Malformed token subject.")

    user = db.get(User, user_id)
    if user is None or not user.active:
        raise APIError(401, "unauthorized", "User no longer exists or is inactive.")
    return user


def require_min_role(minimum: UserRole):
    """Dependency factory: require the acting user to be at least `minimum`."""

    def _dep(user: User = Depends(current_user)) -> User:
        if _ROLE_ORDER[user.role] < _ROLE_ORDER[minimum]:
            raise APIError(
                403,
                "forbidden",
                f"Requires {minimum.value} role or higher.",
            )
        return user

    return _dep


# Convenience dependencies used across routers.
require_manager = require_min_role(UserRole.manager)
require_admin = require_min_role(UserRole.admin)
