from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)


class ChatIn(BaseModel):
    """The whole visible conversation, resent each turn.

    The browser holds plain text only — no tool calls or tool results — so it
    cannot feed the model a fabricated lookup. Tools are re-run server-side
    every turn against current data.
    """

    messages: list[ChatTurn] = Field(min_length=1, max_length=40)


class Proposal(BaseModel):
    action: str
    args: dict[str, Any]
    summary: str  # built server-side from the validated args, never by the model


class ChatOut(BaseModel):
    reply: str
    proposal: Proposal | None = None


class ActIn(BaseModel):
    """A proposal the person confirmed on screen."""

    action: str
    args: dict[str, Any] = Field(default_factory=dict)


class ActOut(BaseModel):
    result: str
