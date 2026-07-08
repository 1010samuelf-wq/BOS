"""Delivery manifest (spec §2A, §11). Operational — any authenticated user."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import current_user
from app.core.permissions import require_section
from app.core.csv_export import csv_response
from app.database import get_db
from app.models import User
from app.models.base import utc_today
from app.schemas.report import DeliveriesOut
from app.services import reports as reports_service

router = APIRouter(
    prefix="/deliveries", tags=["deliveries"],
    dependencies=[Depends(require_section("deliveries"))],
)


def _range(from_date: date | None, to_date: date | None) -> tuple[date, date]:
    today = utc_today()
    return from_date or today, to_date or today  # defaults to today (§2A)


@router.get("", response_model=DeliveriesOut)
def deliveries(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    f, t = _range(from_date, to_date)
    return reports_service.deliveries_manifest(db, f, t)


@router.get("/export")
def export_deliveries(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    f, t = _range(from_date, to_date)
    manifest = reports_service.deliveries_manifest(db, f, t)
    rows = [
        [
            row.needed_for_date or "",
            row.client_name,
            row.delivery_name or "",
            row.client_phone or "",
            row.delivery_address or "",
            "; ".join(f"{i.quantity}× {i.product_name}" for i in row.items),
            row.box_count,
            row.total,
            row.paid_status,
        ]
        for row in manifest.rows
    ]
    return csv_response(
        f"deliveries_{f}_{t}.csv",
        ["needed_for", "client", "recipient", "phone", "address", "items", "boxes", "total", "paid"],
        rows,
    )
