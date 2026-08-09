"""Permanent order deletion (admin-only, cancel first — spec: clean up test
or mistaken entries; distinct from Cancel, which keeps an audit trail)."""

from tests.conftest import order_payload


def test_cannot_delete_an_active_order(client, make_product):
    p = make_product()
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "del-active1")).json()["id"]

    r = client.delete(f"/api/v1/orders/{oid}")

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "order_not_cancelled"
    assert client.get(f"/api/v1/orders/{oid}").status_code == 200  # still there


def test_delete_after_cancel_removes_the_order(client, make_product):
    p = make_product()
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "del-ok-1234")).json()["id"]
    client.post(f"/api/v1/orders/{oid}/cancel", json={"reverse_stock": False})

    r = client.delete(f"/api/v1/orders/{oid}")

    assert r.status_code == 204
    assert client.get(f"/api/v1/orders/{oid}").status_code == 404


def test_delete_requires_admin_even_with_orders_section(client, make_product, make_user):
    p = make_product()
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "del-mgr-1234")).json()["id"]
    client.post(f"/api/v1/orders/{oid}/cancel", json={"reverse_stock": False})

    _, _, manager = make_user("mo", "manager")  # has "orders" by default, not admin
    r = manager.delete(f"/api/v1/orders/{oid}")

    assert r.status_code == 403
    assert client.get(f"/api/v1/orders/{oid}").status_code == 200  # untouched


def test_stock_adjustment_history_survives_deletion(client, make_product, make_ingredient, db):
    from app.models import StockAdjustment

    flour = make_ingredient(name="Flour", cost="1.00")
    p = make_product(name="Loaf", price="5.00")
    client.post("/api/v1/recipes", json={"product_id": p["id"], "items": [{"ingredient_id": flour["id"], "quantity": "1"}]})
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "del-audit-1")).json()["id"]
    client.post(f"/api/v1/orders/{oid}/cancel", json={"reverse_stock": False})

    before = db.query(StockAdjustment).filter(StockAdjustment.order_id == oid).count()
    assert before > 0  # the sale deducted stock, leaving an audit row

    r = client.delete(f"/api/v1/orders/{oid}")
    assert r.status_code == 204

    db.expire_all()
    detached = db.query(StockAdjustment).filter(StockAdjustment.order_id.is_(None)).count()
    assert detached >= before  # rows kept, just unlinked from the deleted order
    assert db.query(StockAdjustment).filter(StockAdjustment.order_id == oid).count() == 0
