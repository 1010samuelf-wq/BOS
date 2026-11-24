"""GET /problems — what needs attention, for the dashboard's home screen.

Filtered to the caller's sections inside the service, so it is open to any
signed-in employee; the dashboard shows it to managers and admins only, and
the easy tablet app deliberately doesn't show it at all (the owner's call: it
would confuse the people that app is for). The assistant reads the same list
through its `find_problems` tool.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.database import get_db
from app.models import User
from app.services import problems as problem_service

router = APIRouter(prefix="/problems", tags=["problems"])


class ProblemOut(BaseModel):
    kind: str
    severity: str
    title: str
    detail: str
    count: int
    order_ids: list[int]
    screen: str


@router.get("", response_model=list[ProblemOut])
def list_problems(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return problem_service.as_dicts(problem_service.find(db, user))
