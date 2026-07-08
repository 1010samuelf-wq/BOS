"""Stock deduction / cancellation / adjustment tests (spec §10)."""

from tests.conftest import order_payload


def _set_recipe(client, product_id, ingredient_id, qty):
    r = client.post(
        "/api/v1/recipes",
        json={
            "product_id": product_id,
            "items": [{"ingredient_id": ingredient_id, "quantity": qty}],
        },
    )
    assert r.status_code == 201, r.text


def _stock_of(client, item_type, item_id):
    rows = client.get("/api/v1/stock").json()
    for row in rows:
        if row["item_type"] == item_type and row["item_id"] == item_id:
            return row
    return None


def test_sale_deducts_ingredients_via_recipe(client, make_product, make_ingredient):
    flour = make_ingredient(name="Flour", threshold="0")
    p = make_product()
    _set_recipe(client, p["id"], flour["id"], "0.2")  # 0.2 kg per croissant

    # start with 1 kg flour on hand
    client.post(
        "/api/v1/stock/adjust",
        json={"item_type": "ingredient", "item_id": flour["id"],
              "delta": "1.0", "reason": "initial"},
    )
    # sell 2 croissants → 0.4 kg used → 0.6 left
    client.post("/api/v1/orders", json=order_payload(p["id"], "k-sale-p"))

    row = _stock_of(client, "ingredient", flour["id"])
    assert row["quantity"] == "0.600"


def test_sale_with_recipe_deducts_both_product_and_ingredients(
    client, make_product, make_ingredient
):
    # Dual deduction: a product WITH a recipe moves its own finished stock AND
    # the recipe ingredients on the same sale.
    flour = make_ingredient(name="Flour", threshold="0")
    p = make_product(name="Croissant")
    _set_recipe(client, p["id"], flour["id"], "0.2")

    for item_type, item_id, delta in (
        ("product", p["id"], "10"),
        ("ingredient", flour["id"], "1.0"),
    ):
        client.post(
            "/api/v1/stock/adjust",
            json={"item_type": item_type, "item_id": item_id,
                  "delta": delta, "reason": "initial"},
        )

    # sell 2 croissants
    client.post("/api/v1/orders", json=order_payload(p["id"], "k-dual-p"))

    # finished stock: 10 - 2 = 8 ; flour: 1.0 - (2 × 0.2) = 0.6
    assert _stock_of(client, "product", p["id"])["quantity"] == "8.000"
    assert _stock_of(client, "ingredient", flour["id"])["quantity"] == "0.600"


def test_cancel_reverse_restocks_both_streams(
    client, make_product, make_ingredient
):
    flour = make_ingredient(name="Flour", threshold="0")
    p = make_product(name="Croissant")
    _set_recipe(client, p["id"], flour["id"], "0.2")
    for item_type, item_id, delta in (
        ("product", p["id"], "10"),
        ("ingredient", flour["id"], "1.0"),
    ):
        client.post(
            "/api/v1/stock/adjust",
            json={"item_type": item_type, "item_id": item_id,
                  "delta": delta, "reason": "initial"},
        )
    oid = client.post(
        "/api/v1/orders", json=order_payload(p["id"], "k-dualc1")
    ).json()["id"]

    client.post(f"/api/v1/orders/{oid}/cancel", json={"reverse_stock": True})
    # both streams restored to their starting levels
    assert _stock_of(client, "product", p["id"])["quantity"] == "10.000"
    assert _stock_of(client, "ingredient", flour["id"])["quantity"] == "1.000"


def test_sale_allowed_into_negative_stock(client, make_product, make_ingredient):
    sugar = make_ingredient(name="Sugar", threshold="0")
    p = make_product()
    _set_recipe(client, p["id"], sugar["id"], "1.0")

    # no stock added — selling 2 drives sugar to -2 (never blocked, spec §1)
    r = client.post("/api/v1/orders", json=order_payload(p["id"], "k-neg-pa"))
    assert r.status_code == 201
    row = _stock_of(client, "ingredient", sugar["id"])
    assert row["quantity"] == "-2.000"
    assert row["is_low"] is True


def test_product_without_recipe_deducts_finished_stock(client, make_product):
    # bought-in item: no recipe → its own product stock is deducted
    p = make_product(name="Soda")
    client.post(
        "/api/v1/stock/adjust",
        json={"item_type": "product", "item_id": p["id"],
              "delta": "10", "reason": "initial"},
    )
    client.post("/api/v1/orders", json=order_payload(p["id"], "k-fin-pa"))  # qty 2
    row = _stock_of(client, "product", p["id"])
    assert row["quantity"] == "8.000"


def test_cancel_with_reverse_restocks(client, make_product, make_ingredient):
    flour = make_ingredient(name="Flour", threshold="0")
    p = make_product()
    _set_recipe(client, p["id"], flour["id"], "0.5")
    client.post(
        "/api/v1/stock/adjust",
        json={"item_type": "ingredient", "item_id": flour["id"],
              "delta": "5", "reason": "initial"},
    )
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "k-can-pa")).json()["id"]
    # 2 × 0.5 = 1 kg used → 4 left
    assert _stock_of(client, "ingredient", flour["id"])["quantity"] == "4.000"

    r = client.post(f"/api/v1/orders/{oid}/cancel", json={"reverse_stock": True})
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"
    assert r.json()["stock_reversed"] is True
    # restored back to 5
    assert _stock_of(client, "ingredient", flour["id"])["quantity"] == "5.000"


def test_cancel_without_reverse_leaves_stock(client, make_product, make_ingredient):
    flour = make_ingredient(name="Flour", threshold="0")
    p = make_product()
    _set_recipe(client, p["id"], flour["id"], "0.5")
    client.post(
        "/api/v1/stock/adjust",
        json={"item_type": "ingredient", "item_id": flour["id"],
              "delta": "5", "reason": "initial"},
    )
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "k-can2-p")).json()["id"]

    r = client.post(f"/api/v1/orders/{oid}/cancel", json={"reverse_stock": False})
    assert r.status_code == 200
    assert r.json()["stock_reversed"] is False
    # stock stays deducted (items were made/wasted)
    assert _stock_of(client, "ingredient", flour["id"])["quantity"] == "4.000"


def test_low_stock_toggle_and_adjust_audit(client, make_ingredient):
    salt = make_ingredient(name="Salt", threshold="3")
    # push below threshold
    client.post(
        "/api/v1/stock/adjust",
        json={"item_type": "ingredient", "item_id": salt["id"],
              "delta": "2", "reason": "initial"},
    )
    low = client.get("/api/v1/stock", params={"low_only": True}).json()
    assert any(r["item_id"] == salt["id"] for r in low)

    # zero delta rejected
    r = client.post(
        "/api/v1/stock/adjust",
        json={"item_type": "ingredient", "item_id": salt["id"],
              "delta": "0", "reason": "noop"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "zero_delta"


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
