"""Custom (not-in-catalog) order items — enter a one-off name+price at order
time, with an option to keep it as a regular product afterward. No schema
change needed: a custom item always becomes a real Product row under the
hood; `save_as_product` just controls whether it's `active` (visible in
search/tap-grid/menu) or stays hidden as a one-off (spec: custom product
entry with an optional "save as regular product").
"""

from tests.conftest import order_payload


def _custom_payload(key, custom_name="Birthday Special", custom_price="42.00", save_as_product=False, **overrides):
    payload = {
        "idempotency_key": key,
        "client_name": "Jane Doe",
        "fulfillment_type": "pickup",
        "payment_timing": "now",
        "payment_method": "cash",
        "items": [{
            "custom_name": custom_name,
            "custom_price": custom_price,
            "save_as_product": save_as_product,
            "quantity": 1,
        }],
    }
    payload.update(overrides)
    return payload


def test_custom_item_creates_order_with_correct_total(client):
    r = client.post("/api/v1/orders", json=_custom_payload("custom-1"))
    assert r.status_code == 201, r.text
    order = r.json()
    assert order["total"] == "42.00"
    assert order["items"][0]["product_name"] == "Birthday Special"
    assert order["items"][0]["unit_price"] == "42.00"
    assert order["items"][0]["product_id"] is not None


def test_custom_item_not_saved_stays_inactive_and_hidden(client):
    r = client.post("/api/v1/orders", json=_custom_payload("custom-2", save_as_product=False))
    product_id = r.json()["items"][0]["product_id"]

    # Hidden from the normal active-only catalog list...
    catalog = client.get("/api/v1/products", params={"active": True}).json()
    assert product_id not in [p["id"] for p in catalog]
    # ...and from the public menu.
    public = client.get("/api/v1/public/products").json()
    assert product_id not in [p["id"] for p in public]
    # but it's a real product underneath (visible when including inactive).
    all_products = client.get("/api/v1/products").json()
    assert product_id in [p["id"] for p in all_products]


def test_custom_item_saved_as_product_is_active_and_reusable(client, make_product):
    r = client.post("/api/v1/orders", json=_custom_payload(
        "custom-3", custom_name="Anniversary Cake", custom_price="55.00", save_as_product=True,
    ))
    product_id = r.json()["items"][0]["product_id"]

    catalog = client.get("/api/v1/products", params={"active": True}).json()
    assert product_id in [p["id"] for p in catalog]

    # Reusable on the next order via a normal product_id, like any product.
    r2 = client.post("/api/v1/orders", json=order_payload(product_id, "custom-3-reuse"))
    assert r2.status_code == 201, r2.text
    assert r2.json()["items"][0]["product_name"] == "Anniversary Cake"


def test_custom_item_deducts_stock_like_a_normal_product(client):
    r = client.post("/api/v1/orders", json=_custom_payload("custom-4", save_as_product=True))
    product_id = r.json()["items"][0]["product_id"]

    stock = client.get("/api/v1/stock", params={"item_type": "product"}).json()
    row = next((s for s in stock if s["item_id"] == product_id), None)
    assert row is not None
    assert row["quantity"] == "-1.000"  # sold before ever being stocked, same as any product


def test_item_needs_either_product_or_custom_not_both_or_neither(client, make_product):
    p = make_product()
    # neither
    r = client.post("/api/v1/orders", json={
        "idempotency_key": "bad-1", "client_name": "X", "fulfillment_type": "pickup",
        "payment_timing": "now", "payment_method": "cash",
        "items": [{"quantity": 1}],
    })
    assert r.status_code == 400

    # both
    r = client.post("/api/v1/orders", json={
        "idempotency_key": "bad-2", "client_name": "X", "fulfillment_type": "pickup",
        "payment_timing": "now", "payment_method": "cash",
        "items": [{"product_id": p["id"], "custom_name": "X", "custom_price": "1.00", "quantity": 1}],
    })
    assert r.status_code == 400


def test_cashier_can_add_custom_item_without_settings_access(client, make_user):
    """Adding a custom item is part of taking an order (orders section), not
    catalog administration (settings section) — a cashier can do it."""
    _, _, cashier = make_user("nora", "cashier")
    r = cashier.post("/api/v1/orders", json=_custom_payload("custom-cashier"))
    assert r.status_code == 201, r.text
