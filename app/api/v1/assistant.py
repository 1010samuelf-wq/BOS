"""The in-app assistant.

Open to any signed-in employee: the tools it can reach are filtered by that
person's own permissions, so a cashier's assistant simply has fewer tools than
an admin's rather than a different set of rules.

`/chat` never changes anything — at most it returns a proposal. `/act` is the
only endpoint that writes, and it re-checks permissions against the caller.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.core.errors import APIError
from app.database import get_db
from app.models import User
from app.schemas.assistant import ActIn, ActOut, ChatIn, ChatOut
from app.services import assistant as assistant_service

router = APIRouter(prefix="/assistant", tags=["assistant"])


@router.get("/status")
def status(_: User = Depends(current_user)):
    """Whether the assistant is configured, so the UI can hide itself."""
    return {"enabled": assistant_service.is_enabled()}


@router.post("/chat", response_model=ChatOut)
def chat(
    payload: ChatIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if payload.messages[-1].role != "user":
        raise APIError(400, "bad_request", "The last message must be from the user.")
    out = assistant_service.chat(
        db, user, [m.model_dump() for m in payload.messages]
    )
    return ChatOut(**out)


@router.post("/act", response_model=ActOut)
def act(
    payload: ActIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Run a proposal the person confirmed. The only writing endpoint here."""
    result = assistant_service.execute(db, user, payload.action, payload.args)
    return ActOut(result=result)
