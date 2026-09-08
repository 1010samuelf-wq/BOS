"""Business-profile settings (spec §2I/§4).

Readable by any authenticated user (it renders on the manifest/receipt header);
writes are Admin-only. (No printer config — receipts are exported as PDF and
printed from the tablet's own print/share tool.)
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.core.permissions import require_section
from app.database import get_db
from app.models import User
from app.config import get_settings
from app.schemas.settings import (
    BusinessProfileIn,
    BusinessProfileOut,
    TabletBuildOut,
)
from app.services import settings as settings_service

router = APIRouter(
    prefix="/settings", tags=["settings"],
    dependencies=[Depends(require_section("settings"))],
)


@router.get("/business-profile", response_model=BusinessProfileOut)
def get_business_profile(
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    return settings_service.get_settings_row(db)


@router.put("/business-profile", response_model=BusinessProfileOut)
def update_business_profile(
    payload: BusinessProfileIn,
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    row = settings_service.update_fields(db, **payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(row)
    return row


@router.get("/tablet-build", response_model=TabletBuildOut)
def tablet_build(_: User = Depends(current_user)):
    """Where to get the current tablet APK.

    Staff need this whenever a tablet is replaced, reset, or is still on an
    older binary — an over-the-air update only reaches tablets whose installed
    version matches, so a tablet left behind can only be caught up by
    installing the APK.
    """
    cfg = get_settings()
    return TabletBuildOut(
        version=cfg.tablet_apk_version,
        build=cfg.tablet_apk_build,
        built_on=cfg.tablet_apk_built_on,
        url=cfg.tablet_apk_url,
    )
