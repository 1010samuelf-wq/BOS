"""Bookkeeping & operational reports (spec §2D, §2G, §11).

Financial reports (sales/daily/monthly, all-staff hours) are Manager+; the
production bake-list is operational and open to any authenticated user (the
kitchen needs it).
"""

import calendar
from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.permissions import require_section
from app.core.csv_export import csv_response
from app.core.errors import bad_request
from app.database import get_db
from app.models import AppSettings, FulfillmentType, User
from app.models.base import utc_today
from app.schemas.report import (
    HoursReportOut,
    ProductionReportOut,
    SalesReportOut,
)
from app.services import pdf as pdf_service
from app.services import reports as reports_service

router = APIRouter(prefix="/reports", tags=["reports"])


def _range(from_date: date | None, to_date: date | None) -> tuple[date, date]:
    if from_date is None or to_date is None:
        today = utc_today()
        return from_date or today, to_date or today
    if to_date < from_date:
        raise bad_request("'to' must not be before 'from'", code="bad_date_range")
    return from_date, to_date


# ---- sales / bookkeeping ----
@router.get("/summary", response_model=SalesReportOut)
def sales_summary(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: User = Depends(require_section("reports")),
):
    f, t = _range(from_date, to_date)
    return reports_service.sales_report(db, f, t)


@router.get("/daily", response_model=SalesReportOut)
def daily_report(
    day: date | None = Query(default=None, description="defaults to today"),
    db: Session = Depends(get_db),
    _: User = Depends(require_section("reports")),
):
    d = day or utc_today()
    return reports_service.sales_report(db, d, d)


@router.get("/monthly", response_model=SalesReportOut)
def monthly_report(
    year: int | None = Query(default=None, ge=2000, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    db: Session = Depends(get_db),
    _: User = Depends(require_section("reports")),
):
    today = utc_today()
    y, m = year or today.year, month or today.month
    first = date(y, m, 1)
    last = date(y, m, calendar.monthrange(y, m)[1])
    return reports_service.sales_report(db, first, last)


@router.get("/summary/export")
def export_summary(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: User = Depends(require_section("reports")),
):
    f, t = _range(from_date, to_date)
    r = reports_service.sales_report(db, f, t)
    pb = r.payment_breakdown
    rows = [
        ["Revenue", r.revenue],
        ["Orders", r.order_count],
        ["Ingredient cost", r.ingredient_cost],
        ["Expenses", r.expenses_total],
        ["Profit", r.profit],
        ["Cash", pb.cash],
        ["Card", pb.card],
        ["E-transfer", pb.etransfer],
        ["Unspecified (paid)", pb.unspecified],
        ["Unpaid (booked)", pb.unpaid],
    ]
    return csv_response(f"sales_{f}_{t}.csv", ["metric", "value"], rows)


@router.get("/summary/pdf")
def export_summary_pdf(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: User = Depends(require_section("reports")),
):
    """Sales report as a PDF (spec §2D — CSV/PDF export)."""
    f, t = _range(from_date, to_date)
    report = reports_service.sales_report(db, f, t)
    content = pdf_service.render_sales_report(report, db.get(AppSettings, 1))
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="sales_{f}_{t}.pdf"'},
    )


# ---- production / bake list ----
@router.get("/production", response_model=ProductionReportOut)
def production(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    fulfillment: FulfillmentType | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_section("production")),
):
    f, t = _range(from_date, to_date)
    return reports_service.production_report(db, f, t, fulfillment)


@router.get("/production/export")
def export_production(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    fulfillment: FulfillmentType | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_section("production")),
):
    f, t = _range(from_date, to_date)
    r = reports_service.production_report(db, f, t, fulfillment)
    rows = [
        [row.product_name, row.total_quantity, row.order_count, row.in_stock, row.to_bake]
        for row in r.rows
    ]
    rows.append(["TOTAL", r.total_needed, "", "", r.total_to_bake])
    return csv_response(
        f"production_{f}_{t}.csv",
        ["product", "needed", "orders", "in_stock", "to_bake"],
        rows,
    )


# ---- all-staff weekly hours ----
@router.get("/hours", response_model=HoursReportOut)
def staff_hours(
    week: date | None = Query(default=None, description="any day in the week"),
    db: Session = Depends(get_db),
    _: User = Depends(require_section("reports")),
):
    return reports_service.all_staff_hours(db, week or utc_today())
