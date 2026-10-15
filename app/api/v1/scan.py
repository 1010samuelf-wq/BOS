"""Scan a document: a photo or PDF of an order form or a vendor invoice comes
back as a draft for a person to check. Nothing is saved here — the order opens
in New Order, the invoice in a review form that saves through the normal
bookkeeping endpoint.
"""

from fastapi import APIRouter, Depends, Form, UploadFile
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.permissions import require_any_section
from app.database import get_db
from app.models import User
from app.schemas.scan import ScanKindsOut, ScanOut
from app.services import doc_scan

router = APIRouter(prefix="/scan", tags=["scan"])


@router.get("", response_model=ScanKindsOut)
def scan_options(user: User = Depends(require_any_section("orders", "bookkeeping"))):
    """What this person can scan, and whether reading is switched on at all."""
    return ScanKindsOut(kinds=doc_scan.allowed_kinds(user),
                        enabled=bool(get_settings().anthropic_api_key))


@router.post("", response_model=ScanOut)
async def scan_document(
    file: UploadFile,
    hint: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(require_any_section("orders", "bookkeeping")),
):
    data = await file.read()
    return doc_scan.scan(db, user, data=data, content_type=file.content_type or "", hint=hint)
