from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_settings = get_settings()

# SQLite (used by the test suite) needs a special flag and ignores server-side
# pooling knobs; Postgres (prod) uses a normal pooled engine.
_is_sqlite = _settings.database_url.startswith("sqlite")
_engine_kwargs: dict = {"future": True, "pool_pre_ping": True}
if _is_sqlite:
    from sqlalchemy.pool import StaticPool

    _engine_kwargs = {
        "future": True,
        "connect_args": {"check_same_thread": False},
        "poolclass": StaticPool,
    }

engine = create_engine(_settings.database_url, **_engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a request-scoped session.

    The route/service layer owns commit/rollback semantics; this only
    guarantees the session is closed and rolls back anything left dangling.
    """
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
