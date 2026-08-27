"""Staff feedback (see app/models/feedback.py)."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Feedback, User
from app.models.base import utcnow
from app.schemas.feedback import FeedbackCreate, FeedbackOut

logger = logging.getLogger("bos.feedback")


def create_feedback(db: Session, payload: FeedbackCreate, user: User) -> Feedback:
    row = Feedback(
        message=payload.message.strip(),
        source=payload.source,
        context=payload.context,
        user_id=user.id,
        created_at=utcnow(),
    )
    db.add(row)
    db.flush()
    # Mirror every submission into the structured logs as well as the table.
    # The log line is what makes feedback visible to whoever is operating the
    # deploy (`flyctl logs`) without handing them database credentials.
    # NOTE: `extra=` keys must not collide with stdlib LogRecord attributes —
    # a bare `message` raises KeyError, hence the prefixes.
    logger.info(
        "feedback_submitted",
        extra={
            "feedback_id": row.id,
            "feedback_source": row.source,
            "feedback_context": row.context,
            "feedback_user": user.name,
            "feedback_message": row.message,
        },
    )
    return row


def list_feedback(
    db: Session, *, handled: bool | None = None, limit: int = 200
) -> list[Feedback]:
    stmt = select(Feedback)
    if handled is not None:
        stmt = stmt.where(Feedback.handled == handled)
    # Newest first — this is a read-and-triage list, not a chronological log.
    stmt = stmt.order_by(Feedback.created_at.desc(), Feedback.id.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())


def set_handled(db: Session, row: Feedback, handled: bool, actor: User) -> Feedback:
    row.handled = handled
    row.handled_by = actor.id if handled else None
    row.handled_at = utcnow() if handled else None
    db.flush()
    return row


def to_out(db: Session, row: Feedback) -> FeedbackOut:
    """Attach the submitter's name so the reader doesn't have to resolve ids."""
    out = FeedbackOut.model_validate(row)
    if row.user_id is not None:
        user = db.get(User, row.user_id)
        out.user_name = user.name if user else None
    return out
