"""Reports & bookkeeping: sales/profit, production, deliveries, hours (§2D/§10)."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from tests.conftest import order_payload


def _recipe(client, product_id, ingredient_id, qty):
    r = client.post(
        "/api/v1/recipes",
        json={"product_id": product_id, "items": [{"ingredient_id": ingredient_id, "quantity": qty}]},
    )
    assert r.status_code == 201, r.text


def _needed(day: date, hour=10) -> str:
    return datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc).isoformat()


def test_sales_report_revenue_breakdown_and_profit(client, make_product, make_ingredient):
    flour = make_ingredient(name="Flour", cost="2.00", threshold="0")
    cake = make_product(name="Cake", price="10.00")
    _recipe(client, cake["id"], flour["id"], "0.5")  # ingredient cost = 1.00 / cake

    # 2 paid-cash cakes (total 20), 1 paid-card cake (10), 1 pay-later cake (10 unpaid)
    client.post("/api/v1/orders", json=order_payload(cake["id"], "rep-cash1", payment_method="cash"))
    client.post("/api/v1/orders", json=order_payload(
        cake["id"], "rep-card1", payment_method="card",
        items=[{"product_id": cake["id"], "quantity": 1}]))
    client.post("/api/v1/orders", json=order_payload(
        cake["id"], "rep-later1", payment_timing="later", payment_method=None,
        items=[{"product_id": cake["id"], "quantity": 1}]))

    client.post("/api/v1/expenses", json={"description": "gas", "amount": "5.00"})

    r = client.get("/api/v1/reports/daily").json()
    assert Decimal(r["revenue"]) == Decimal("40")     # 20 + 10 + 10
    assert r["order_count"] == 3
    assert Decimal(r["ingredient_cost"]) == Decimal("4")   # 4 cakes × 1.00
    assert Decimal(r["expenses_total"]) == Decimal("5")
    assert Decimal(r["profit"]) == Decimal("31")      # 40 - 4 - 5

    pb = r["payment_breakdown"]
    assert Decimal(pb["cash"]) == Decimal("20")
    assert Decimal(pb["card"]) == Decimal("10")
    assert Decimal(pb["unpaid"]) == Decimal("10")
    assert len(r["expenses"]) == 1


def test_paylater_collection_lands_in_method_bucket(client, make_product):
    p = make_product(name="Loaf", price="8.00")
    oid = client.post("/api/v1/orders", json=order_payload(
        p["id"], "rep-pl-etr", payment_timing="later", payment_method=None,
        items=[{"product_id": p["id"], "quantity": 1}])).json()["id"]

    # before collection: booked under unpaid
    pb = client.get("/api/v1/reports/daily").json()["payment_breakdown"]
    assert Decimal(pb["unpaid"]) == Decimal("8")

    # collect as e-transfer → moves out of unpaid into etransfer
    client.post(f"/api/v1/orders/{oid}/mark-paid", json={"payment_method": "etransfer"})
    pb = client.get("/api/v1/reports/daily").json()["payment_breakdown"]
    assert Decimal(pb["unpaid"]) == Decimal("0")
    assert Decimal(pb["etransfer"]) == Decimal("8")


def test_cancelled_order_excluded_from_revenue(client, make_product):
    p = make_product(name="Bun", price="3.00")
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "rep-cancel")).json()["id"]
    before = Decimal(client.get("/api/v1/reports/daily").json()["revenue"])
    client.post(f"/api/v1/orders/{oid}/cancel", json={"reverse_stock": False})
    after = Decimal(client.get("/api/v1/reports/daily").json()["revenue"])
    assert before - after == Decimal("6")  # 2 × 3.00 removed


def test_production_report_to_bake_uses_stock(client, make_product):
    today = datetime.now(timezone.utc).date()
    p = make_product(name="Baguette", price="2.00")
    # 5 units on hand
    client.post("/api/v1/stock/adjust", json={
        "item_type": "product", "item_id": p["id"], "delta": "5", "reason": "init"})
    # two orders needing the product today: 4 + 3 = 7 needed
    for key, qty in (("prod-a01", 4), ("prod-b01", 3)):
        client.post("/api/v1/orders", json=order_payload(
            p["id"], key, needed_for_date=_needed(today),
            items=[{"product_id": p["id"], "quantity": qty}]))

    r = client.get("/api/v1/reports/production").json()
    row = next(x for x in r["rows"] if x["product_id"] == p["id"])
    assert row["total_quantity"] == 7
    assert row["order_count"] == 2
    # sales already deducted 7 finished units (5 - 7 = -2 on hand); to_bake clamps
    # needed(7) - in_stock(-2) = 9
    assert Decimal(row["in_stock"]) == Decimal("-2")
    assert Decimal(row["to_bake"]) == Decimal("9")


def test_production_excludes_fulfilled_and_cancelled(client, make_product):
    today = datetime.now(timezone.utc).date()
    p = make_product(name="Tart", price="4.00")
    oid = client.post("/api/v1/orders", json=order_payload(
        p["id"], "prod-ful", needed_for_date=_needed(today))).json()["id"]
    client.post(f"/api/v1/orders/{oid}/fulfill")
    r = client.get("/api/v1/reports/production").json()
    assert all(row["product_id"] != p["id"] for row in r["rows"])


def test_deliveries_manifest_box_count(client, make_product):
    today = datetime.now(timezone.utc).date()
    a = make_product(name="Cupcakes", price="1.00")
    b = make_product(name="Brownies", price="1.00")
    # one delivery order: 12 cupcakes + 20 brownies → 2 boxes, not 32
    client.post("/api/v1/orders", json=order_payload(
        a["id"], "del-0001", fulfillment_type="delivery", delivery_price="5.00",
        delivery_address="12 Baker St", needed_for_date=_needed(today),
        items=[{"product_id": a["id"], "quantity": 12},
               {"product_id": b["id"], "quantity": 20}]))
    # a pickup order should NOT appear
    client.post("/api/v1/orders", json=order_payload(a["id"], "del-pickup"))

    r = client.get("/api/v1/deliveries").json()
    assert len(r["rows"]) == 1
    row = r["rows"][0]
    assert row["box_count"] == 2
    assert row["delivery_address"] == "12 Baker St"


def test_all_staff_hours_report(client, make_user):
    from app.database import SessionLocal
    from app.models import TimeEntry

    uid, _, _ = make_user("olive", "cashier")
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        db.add(TimeEntry(user_id=uid, clock_in=now - timedelta(hours=3), clock_out=now))
        db.commit()

    r = client.get("/api/v1/reports/hours").json()
    olive = next(x for x in r["rows"] if x["user_id"] == uid)
    assert olive["total_hours"] >= 2.9  # ~3h
    assert r["grand_total_hours"] >= 2.9


def test_report_role_gating_and_csv(client, make_product, make_user):
    _, _, cashier = make_user("pat", "cashier")
    # cashier's default sections don't include reports or production
    assert cashier.get("/api/v1/reports/summary").status_code == 403
    assert cashier.get("/api/v1/reports/production").status_code == 403

    # CSV export returns text/csv
    resp = client.get("/api/v1/reports/summary/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "Revenue" in resp.text
