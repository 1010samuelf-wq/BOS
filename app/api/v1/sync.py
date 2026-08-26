"""Offline write-queue replay (spec: bakery-floor offline mode).

A tablet that queued actions while offline flushes them here as one batch on
reconnect. No single `require_section` gate — a batch can span sections (an
order edit and a clock-out in the same flush) — each op's own section/role is
checked individually in app/services/sync_dispatch.py.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.database import get_db
from app.models import User
from app.schemas.sync import SyncReplayIn, SyncReplayOut
from app.services import sync_dispatch

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/replay", response_model=SyncReplayOut)
def replay(
    payload: SyncReplayIn,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    results = sync_dispatch.replay_batch(db, payload.device_id, payload.operations)
    return SyncReplayOut(results=results)
