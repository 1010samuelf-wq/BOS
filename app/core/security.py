"""PIN hashing (PBKDF2, stdlib) and JWT issue/verify (spec §2E, §6).

PINs are hashed with PBKDF2-HMAC-SHA256 + per-PIN salt — no third-party crypto
dependency, constant-time verification. JWTs are short-lived HS256 tokens
signed with ``BOS_JWT_SECRET``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
from datetime import timedelta

import jwt

from app.config import get_settings
from app.models.base import utcnow

_PBKDF2_ITERATIONS = 200_000
_ALGO_TAG = "pbkdf2_sha256"


# ---- PIN hashing ------------------------------------------------------------
def hash_pin(pin: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, _PBKDF2_ITERATIONS)
    return "${}${}${}${}".format(
        _ALGO_TAG,
        _PBKDF2_ITERATIONS,
        base64.b64encode(salt).decode(),
        base64.b64encode(dk).decode(),
    ).lstrip("$")


def verify_pin(pin: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != _ALGO_TAG:
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, int(iters))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk, expected)


# ---- JWT --------------------------------------------------------------------
def create_access_token(user_id: int, role: str) -> str:
    settings = get_settings()
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError (incl. ExpiredSignatureError) on any problem."""
    settings = get_settings()
    return jwt.decode(
        token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
    )
