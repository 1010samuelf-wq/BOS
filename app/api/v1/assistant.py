"""The in-app assistant.

Open to any signed-in employee: the tools it can reach are filtered by that
person's own permissions, so a cashier's assistant simply has fewer tools than
an admin's rather than a different set of rules.

`/chat` never changes shop data — at most it returns a proposal. `/act` is the
only endpoint that writes, and it re-checks permissions against the caller.
Conversations are private to the employee who had them.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.database import get_db
from app.models import User
from app.schemas.assistant import (
    ActIn,
    ActOut,
    ChatIn,
    ChatOut,
    ChatTurn,
    ConversationOut,
    ConversationSummary,
)
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
    out = assistant_service.chat(db, user, payload.message, payload.conversation_id)
    return ChatOut(**out)


@router.get("/conversations", response_model=list[ConversationSummary])
def list_conversations(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return [
        ConversationSummary(id=c.id, title=c.title, updated_at=c.updated_at)
        for c in assistant_service.list_conversations(db, user)
    ]


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
def get_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    convo = assistant_service.own_conversation(db, user, conversation_id)
    return ConversationOut(
        id=convo.id,
        title=convo.title,
        messages=[ChatTurn(role=m.role, text=m.text) for m in convo.messages],
    )


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    assistant_service.delete_conversation(db, user, conversation_id)


@router.post("/act", response_model=ActOut)
def act(
    payload: ActIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Run a proposal the person confirmed. The only writing endpoint here."""
    result = assistant_service.execute(db, user, payload.action, payload.args)
    return ActOut(result=result)
