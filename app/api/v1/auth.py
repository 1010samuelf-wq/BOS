from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas.auth import LoginIn, RosterEntry, SetPinIn, TokenOut
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/roster", response_model=list[RosterEntry])
def roster(db: Session = Depends(get_db)):
    """Active employees for the shared-device login picker (unauthenticated —
    no token exists before login). Minimal fields only; no PIN/hash exposed."""
    return db.execute(
        select(User).where(User.active.is_(True)).order_by(User.name)
    ).scalars().all()


@router.post("/set-pin", status_code=204)
def set_pin(payload: SetPinIn, db: Session = Depends(get_db)):
    """First-login PIN setup. Unauthenticated by design — a newly created
    employee has no token yet — but only works while no PIN is set (spec §2E)."""
    auth_service.set_pin(db, payload)
    db.commit()


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    return auth_service.login(db, payload)
