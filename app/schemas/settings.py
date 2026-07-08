from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class BusinessProfileIn(BaseModel):
    business_name: str | None = None
    business_address: str | None = None
    business_phone: str | None = None


class BusinessProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    business_name: str | None
    business_address: str | None
    business_phone: str | None
