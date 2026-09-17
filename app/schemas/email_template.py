from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class EmailTemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    subject: str = Field(default="", max_length=300)
    intro: str | None = None
    signoff: str | None = None
    # The selection is part of the template — that's the point of saving one.
    product_ids: list[int] = Field(default_factory=list)


class EmailTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    subject: str
    intro: str | None
    signoff: str | None
    product_ids: list[int]
    created_by: int | None
    created_at: datetime
    updated_at: datetime
