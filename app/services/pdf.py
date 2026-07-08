"""PDF generation for receipts and reports (spec §2A/§2D).

Produces plain A4/Letter documents (fpdf2) — the client fetches the bytes and
hands them to the tablet's own print/share sheet or downloads them. There is no
server-side printer (that was dropped by decision); this only renders the file.

Core fonts are latin-1 only, so text is sanitised to latin-1 (covers Western/
French accents like café, crème; drops emoji). Swap in a bundled Unicode TTF if
full Unicode ever matters.
"""

from __future__ import annotations

from decimal import Decimal

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from app.models import AppSettings, Order
from app.schemas.report import SalesReportOut


import os

_LOGO_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "logo.png")
_LOGO_ASPECT = 805 / 933  # height / width of the trimmed logo


def _s(text: object) -> str:
    return str(text).encode("latin-1", "replace").decode("latin-1")


def _header(pdf: FPDF, profile: AppSettings | None) -> None:
    # Logo on top (it carries the shop name). Business address/phone below it if
    # the admin has set them; otherwise the logo stands alone.
    if os.path.exists(_LOGO_PATH):
        w = 52.0
        top = pdf.get_y()
        pdf.image(_LOGO_PATH, x=(pdf.w - w) / 2, y=top, w=w)
        pdf.set_y(top + w * _LOGO_ASPECT + 2)
    else:
        name = (profile.business_name if profile else None) or "Bakery"
        pdf.set_font("Helvetica", "B", 18)
        pdf.cell(0, 10, _s(name), new_x=XPos.LMARGIN, new_y=YPos.NEXT, align="C")

    pdf.set_font("Helvetica", "", 10)
    for line in (profile.business_address if profile else None, profile.business_phone if profile else None):
        if line:
            pdf.cell(0, 5, _s(line), new_x=XPos.LMARGIN, new_y=YPos.NEXT, align="C")
    pdf.ln(3)
    pdf.set_draw_color(200, 200, 200)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(4)


def render_receipt(order: Order, profile: AppSettings | None) -> bytes:
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    _header(pdf, profile)

    # Order meta
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, _s(f"Order #{order.id}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 5, _s(f"Ordered: {order.order_date:%Y-%m-%d %H:%M}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if order.needed_for_date:
        pdf.cell(0, 5, _s(f"Needed for: {order.needed_for_date:%Y-%m-%d %H:%M}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.cell(0, 5, _s(f"Client: {order.client_name}" + (f" ({order.client_phone})" if order.client_phone else "")),
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.cell(0, 5, _s(f"Fulfilment: {order.fulfillment_type.value}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    if order.delivery_address:
        pdf.multi_cell(0, 5, _s(f"Delivery to: {order.delivery_address}"))
    pdf.ln(3)

    # Items table
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(20, 7, "Qty", border="B")
    pdf.cell(110, 7, "Item", border="B")
    pdf.cell(0, 7, "Line total", border="B", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font("Helvetica", "", 10)
    for it in order.items:
        line_total = Decimal(it.unit_price) * it.quantity
        pdf.cell(20, 6, _s(it.quantity))
        name = it.product_name + (f"  - {it.note}" if it.note else "")
        pdf.cell(110, 6, _s(name))
        pdf.cell(0, 6, _s(f"${line_total:.2f}"), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    if order.delivery_price:
        pdf.cell(130, 6, "Delivery")
        pdf.cell(0, 6, _s(f"${Decimal(order.delivery_price):.2f}"), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.ln(1)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(130, 8, "Total")
    pdf.cell(0, 8, _s(f"${Decimal(order.total):.2f}"), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # Payment
    pdf.set_font("Helvetica", "", 10)
    method = f" ({order.payment_method.value})" if order.payment_method else ""
    pdf.cell(0, 6, _s(f"Payment: {order.paid_status.value.upper()}{method}"),
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # Card message + general notes
    if order.card_message:
        pdf.ln(2)
        pdf.set_font("Helvetica", "I", 10)
        pdf.multi_cell(0, 5, _s(f'Card message: "{order.card_message}"'))
    general = [n for n in order.notes if n.type.value == "general"]
    if general:
        pdf.ln(1)
        pdf.set_font("Helvetica", "", 9)
        for n in general:
            pdf.multi_cell(0, 5, _s(f"- {n.text}"))

    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 10)
    pdf.cell(0, 6, "Thank you!", new_x=XPos.LMARGIN, new_y=YPos.NEXT, align="C")

    return bytes(pdf.output())


def render_sales_report(report: SalesReportOut, profile: AppSettings | None) -> bytes:
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    _header(pdf, profile)

    pdf.set_font("Helvetica", "B", 12)
    span = f"{report.from_date}" if report.from_date == report.to_date else f"{report.from_date} to {report.to_date}"
    pdf.cell(0, 8, _s(f"Sales report - {span}"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)

    def kv(label: str, value: str) -> None:
        pdf.set_font("Helvetica", "", 11)
        pdf.cell(60, 7, _s(label))
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, _s(value), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    kv("Revenue", f"${report.revenue}")
    kv("Orders", str(report.order_count))
    kv("Ingredient cost", f"${report.ingredient_cost}")
    kv("Expenses", f"${report.expenses_total}")
    kv("Profit", f"${report.profit}")

    pdf.ln(3)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "Payment breakdown", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    b = report.payment_breakdown
    for label, val in (("Cash", b.cash), ("Card", b.card), ("E-transfer", b.etransfer),
                       ("Unspecified", b.unspecified), ("Unpaid", b.unpaid)):
        kv(label, f"${val}")

    if report.expenses:
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, "Expenses", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_font("Helvetica", "", 10)
        for e in report.expenses:
            pdf.cell(130, 6, _s(e.description))
            pdf.cell(0, 6, _s(f"${e.amount}"), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    return bytes(pdf.output())
