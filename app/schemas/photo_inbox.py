from datetime import datetime

from pydantic import BaseModel


class InboxPhotoOut(BaseModel):
    id: int
    url: str
    filename: str | None
    uploaded_by: int | None
    uploaded_by_name: str | None
    uploaded_at: datetime


class AssignIn(BaseModel):
    product_id: int
