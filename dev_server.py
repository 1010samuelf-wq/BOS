"""Local dev entrypoint — runs the BOS API against a SQLite file so it works
without Docker or Postgres.

Sets a SQLite DATABASE_URL before anything imports settings, creates the schema
if missing, seeds the `system` admin (id 1) **with a default PIN** so the web
dashboard is loginable out of the box, then serves the API on :8000. This
mirrors what the test suite uses; it is NOT for production (use Postgres +
Alembic + real PINs there — see docker-compose.yml / README).

Dev login: employee "system", PIN 1234.   Docs: http://localhost:8000/docs
"""

import os
from pathlib import Path

# Must be set before any app module reads settings.
_DB_PATH = Path(__file__).with_name("bos_dev.db")
os.environ.setdefault("BOS_DATABASE_URL", f"sqlite:///{_DB_PATH.as_posix()}")

# Dev-only convenience PIN for the seeded admin. Never used in production
# (dev_server.py isn't the prod entrypoint; real employees set their own PIN).
_DEV_ADMIN_PIN = "1234"

from sqlalchemy import select  # noqa: E402

from app.core.security import hash_pin  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.models import Base, User, UserRole  # noqa: E402


def _init_db() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.name == "system"))
        if admin is None:
            admin = User(name="system", role=UserRole.admin, active=True)
            db.add(admin)
        # Seed a default PIN so the web dashboard can log in immediately
        # (its login page can't do first-time PIN setup — that's tablet-only).
        if not admin.pin_set:
            admin.pin_hash = hash_pin(_DEV_ADMIN_PIN)
            admin.pin_set = True
        db.commit()


if __name__ == "__main__":
    import uvicorn

    _init_db()
    print(f"[dev] SQLite DB at {_DB_PATH}")
    print(f"[dev] login -> employee: system   PIN: {_DEV_ADMIN_PIN}")
    print("[dev] docs:  http://localhost:8000/docs")
    # 0.0.0.0 so devices on the LAN (e.g. a tablet running Expo Go) can reach it.
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
