from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.database import get_db
from app.core.errors import APIError
from app.core.ratelimit import client_key, login_limiter
from app.models import User
from app.schemas.auth import ChangePinIn, LoginIn, RosterEntry, SetPinIn, StaffEntry, TokenOut
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/roster", response_model=list[RosterEntry])
def roster(db: Session = Depends(get_db)):
    """Active employees for the shared-device login picker (unauthenticated —
    no token exists before login). Names only; no PIN/hash and no role, so the
    list doesn't say which accounts are the ones worth guessing.
    """
    users = db.execute(
        select(User).where(User.active.is_(True)).order_by(User.name)
    ).scalars().all()
    # Built by hand: reading the ORM row would pick up the real `role`.
    return [RosterEntry(id=u.id, name=u.name) for u in users]


@router.get("/staff", response_model=list[StaffEntry])
def staff(db: Session = Depends(get_db), _: User = Depends(current_user)):
    """Every active employee, admins included, for pickers inside the app.
    The public roster hides admins; signed-in screens still need to name them."""
    return db.execute(
        select(User).where(User.active.is_(True)).order_by(User.name)
    ).scalars().all()


@router.post("/set-pin", status_code=204)
def set_pin(payload: SetPinIn, request: Request, db: Session = Depends(get_db)):
    """First-login PIN setup. Unauthenticated by design — a newly created
    employee has no token yet — but only works while no PIN is set (spec §2E)."""
    auth_service.set_pin(db, payload, client_key(request))
    db.commit()


@router.post("/sign-out-everywhere", status_code=204)
def sign_out_everywhere(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """End every session this employee has, on every device.

    The remedy when a tablet goes missing and you are not an admin. An admin
    resetting the PIN does the same thing, but this needs nobody's help — and
    it takes effect immediately rather than at token expiry.
    """
    user.token_version += 1
    db.commit()


def _rate_limited(request: Request, attempt):
    """Run a PIN check under the per-IP login limit. A right PIN is refunded,
    so only wrong ones use the budget up."""
    client = login_limiter.hit(request)
    try:
        result = attempt(client)
    except APIError as e:
        if e.code == "pin_change_required":
            login_limiter.refund(client)
        raise
    login_limiter.refund(client)
    return result


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    return _rate_limited(request, lambda ip: auth_service.login(db, payload, ip))


@router.post("/change-pin", response_model=TokenOut)
def change_pin(payload: ChangePinIn, request: Request, db: Session = Depends(get_db)):
    """Swap a PIN for a longer one — the way an admin or manager whose old PIN
    is too short gets back in. Unauthenticated (they can't get a session yet),
    so it proves the current PIN under the same lockout and limit as login."""
    return _rate_limited(request, lambda ip: auth_service.change_pin(db, payload, ip))
