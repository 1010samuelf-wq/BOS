"""PDF receipt + report export (spec §2A/§2D)."""

from tests.conftest import order_payload


def _pdf_ok(resp) -> bool:
    return (
        resp.status_code == 200
        and resp.headers["content-type"] == "application/pdf"
        and resp.content[:5] == b"%PDF-"
    )


def test_order_receipt_pdf(client, make_product):
    p = make_product(name="Croissant", price="3.50")
    oid = client.post("/api/v1/orders", json=order_payload(
        p["id"], "receipt-1",
        items=[{"product_id": p["id"], "quantity": 2, "note": "warm please"}],
    )).json()["id"]
    # a note to exercise the notes section
    client.post(f"/api/v1/orders/{oid}/notes", json={"text": "they come and sit"})

    r = client.get(f"/api/v1/orders/{oid}/receipt")
    assert _pdf_ok(r), (r.status_code, r.headers.get("content-type"))
    assert "receipt-" in r.headers.get("content-disposition", "")
    assert len(r.content) > 500  # a real document, not an empty stub


def test_receipt_uses_business_profile_and_delivery(client, make_product):
    client.put("/api/v1/settings/business-profile", json={
        "business_name": "Sunrise Bakery", "business_address": "1 Flour Lane", "business_phone": "555-0100"})
    p = make_product(name="Cake", price="20.00")
    oid = client.post("/api/v1/orders", json=order_payload(
        p["id"], "receipt-del", fulfillment_type="delivery", delivery_price="5.00",
        delivery_address="12 Baker St", card_message="Happy birthday! Love, the family",
    )).json()["id"]
    r = client.get(f"/api/v1/orders/{oid}/receipt")
    assert _pdf_ok(r)


def test_receipt_handles_accents(client, make_product):
    # latin-1 accents must not crash the core-font renderer
    p = make_product(name="Crème brûlée", price="6.00")
    oid = client.post("/api/v1/orders", json=order_payload(
        p["id"], "receipt-acc", client_name="Céline Dupré")).json()["id"]
    r = client.get(f"/api/v1/orders/{oid}/receipt")
    assert _pdf_ok(r)


def test_sales_report_pdf(client, make_product):
    p = make_product(price="4.00")
    client.post("/api/v1/orders", json=order_payload(p["id"], "rep-pdf-1"))
    r = client.get("/api/v1/reports/summary/pdf")
    assert _pdf_ok(r)


def test_report_pdf_requires_manager(client, make_user):
    _, _, cashier = make_user("pdfcashier", "cashier")
    assert cashier.get("/api/v1/reports/summary/pdf").status_code == 403
    # but any authenticated user can print a receipt
    p = make_product = client.post("/api/v1/products", json={"name": "Bun", "price": "1"}).json()
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "rcpt-cash")).json()["id"]
    assert cashier.get(f"/api/v1/orders/{oid}/receipt").status_code == 200
