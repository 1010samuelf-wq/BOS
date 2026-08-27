"""Staff feedback.

Submitting is open to **any** signed-in employee from any screen — that is the
point of the feature, so it is deliberately not behind a section permission.
Reading is admin-only: feedback often names a person or describes something
broken, and it isn't operational data the floor needs.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import current_user, require_admin
from app.core.errors import not_found
from app.database import get_db
from app.models import Feedback, User
from app.schemas.feedback import FeedbackCreate, FeedbackHandledIn, FeedbackOut
from app.services import feedback as feedback_service

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("", response_model=FeedbackOut, status_code=201)
def submit_feedback(
    payload: FeedbackCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    row = feedback_service.create_feedback(db, payload, user)
    db.commit()
    db.refresh(row)
    return feedback_service.to_out(db, row)


@router.get("", response_model=list[FeedbackOut])
def list_feedback(
    handled: bool | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = feedback_service.list_feedback(db, handled=handled)
    return [feedback_service.to_out(db, r) for r in rows]


@router.post("/{feedback_id}/handled", response_model=FeedbackOut)
def set_handled(
    feedback_id: int,
    payload: FeedbackHandledIn | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    row = db.get(Feedback, feedback_id)
    if row is None:
        raise not_found(f"Feedback {feedback_id} not found")
    row = feedback_service.set_handled(
        db, row, payload.handled if payload else True, user
    )
    db.commit()
    db.refresh(row)
    return feedback_service.to_out(db, row)
