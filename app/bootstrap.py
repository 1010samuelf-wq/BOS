"""First-admin bootstrap for a fresh production database.

Production boots plain ``uvicorn`` (not dev_server.py), so a freshly migrated
DB has the schema but zero users — nobody could log in. This creates the
``system`` admin the first time the DB is empty, with a PIN from
``BOS_BOOTSTRAP_ADMIN_PIN`` (default ``1234`` for first-run convenience).

Idempotent and safe to run on every deploy: it no-ops as soon as *any* user
exists, so it never overwrites a real admin or their PIN. Run as the release
step (see fly.toml: ``alembic upgrade head && python -m app.bootstrap``).

SECURITY: change the default PIN immediately after first login.
"""

import os

from sqlalchemy import func, select

from app.core.security import hash_pin
from app.database import SessionLocal
from app.models import User, UserRole


def bootstrap_admin() -> None:
    pin = os.environ.get("BOS_BOOTSTRAP_ADMIN_PIN", "1234")
    with SessionLocal() as db:
        user_count = db.scalar(select(func.count()).select_from(User)) or 0
        if user_count > 0:
            print(f"bootstrap: {user_count} user(s) already exist — skipping.")
            return
        admin = User(
            name="system",
            role=UserRole.admin,
            active=True,
            pin_hash=hash_pin(pin),
            pin_set=True,
        )
        db.add(admin)
        db.commit()
        print(f"bootstrap: created 'system' admin (id={admin.id}).")


if __name__ == "__main__":
    bootstrap_admin()
