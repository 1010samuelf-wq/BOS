from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.database import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(response: Response, db: Session = Depends(get_db)) -> dict:
    """Readiness probe for the uptime monitor (spec §10).

    Checks DB reachability and returns **503** when it fails, so an HTTP-status
    uptime monitor (CloudWatch/pinger) alerts on a degraded server rather than
    seeing a misleading 200. Healthy → 200.
    """
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ok" if db_ok else "degraded",
        "database": db_ok,
        "version": __version__,
    }


@router.get("/health/live")
def liveness() -> dict:
    """Pure liveness — the process is up and serving. No dependency checks, so a
    transient DB blip doesn't cause an orchestrator to kill a healthy process."""
    return {"status": "ok", "version": __version__}
