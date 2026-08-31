from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)


class ChatIn(BaseModel):
    """One new message, against a stored conversation.

    History lives on the server and is loaded by id, so the browser cannot
    rewrite what was said earlier. Tool calls are never stored or replayed —
    every turn re-runs them against current data.
    """

    conversation_id: int | None = None  # omit to start a new conversation
    message: str = Field(min_length=1, max_length=4000)


class Proposal(BaseModel):
    action: str
    args: dict[str, Any]
    summary: str  # built server-side from the validated args, never by the model


class ChatOut(BaseModel):
    conversation_id: int
    title: str
    reply: str
    # A list because one instruction often means several changes; each is
    # described separately so approving the batch is not approving a black box.
    proposals: list[Proposal] = Field(default_factory=list)


class ConversationSummary(BaseModel):
    id: int
    title: str
    updated_at: datetime


class ConversationOut(BaseModel):
    id: int
    title: str
    messages: list[ChatTurn]


class ActIn(BaseModel):
    """A proposal the person confirmed on screen."""

    action: str
    args: dict[str, Any] = Field(default_factory=dict)


class ActOut(BaseModel):
    result: str
