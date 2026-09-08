"""Deleting a product.

There was no delete at all before this — only Deactivate — and the reason is
worth keeping in view: `order_items.product_id` is NOT NULL with
ondelete=RESTRICT, so a product that has been sold genuinely cannot be removed
without taking order history with it. Delete is therefore for mistakes (a typo,
a duplicate, something added and never used); Deactivate remains the tool for a
product the shop has stopped selling.
"""

from decimal import Decimal

from tests.conftest import order_payload


def _names(client):
    return [p["name"] for p in client.get("/api/v1/products").json()]


def _trash(client):
    return client.get("/api/v1/trash").json()


def test_a_product_that_was_never_sold_can_be_deleted(client, make_product):
    p = make_product(name="Typo Cak")
    assert client.delete(f"/api/v1/products/{p['id']}").status_code == 204
    assert "Typo Cak" not in _names(client)


def test_a_sold_product_cannot_be_deleted(client, make_product):
    """The database would refuse anyway; this fails with an explanation
    instead of a foreign-key error."""
    p = make_product(name="Actually sold")
    client.post("/api/v1/orders", json=order_payload(p["id"], "key-pdel-0001"))

    r = client.delete(f"/api/v1/products/{p['id']}")
    assert r.status_code == 400
    body = r.json()["error"]
    assert body["code"] == "product_in_use"
    assert "Deactivate" in body["message"]
    # Still there, still sellable.
    assert "Actually sold" in _names(client)


def test_the_refusal_counts_the_orders(client, make_product):
    p = make_product(name="Popular")
    for i in range(2):
        client.post("/api/v1/orders", json=order_payload(p["id"], f"key-pdel-100{i}"))

    msg = client.delete(f"/api/v1/products/{p['id']}").json()["error"]["message"]
    assert "2 orders" in msg


def test_deleting_leaves_the_order_history_of_other_products_alone(client, make_product):
    keep = make_product(name="Keeper")
    client.post("/api/v1/orders", json=order_payload(keep["id"], "key-pdel-0002"))
    doomed = make_product(name="Doomed")

    client.delete(f"/api/v1/products/{doomed['id']}")

    orders = client.get("/api/v1/orders").json()["items"]
    assert orders[0]["items"][0]["product_name"] == "Keeper"


# ---------------------------------------------------------------------------
# it goes to the trash, like every other delete
# ---------------------------------------------------------------------------
def test_a_deleted_product_lands_in_the_trash(client, make_product):
    p = client.post(
        "/api/v1/products", json={"name": "Wrong Babka", "price": "24.00", "category": "Babka"}
    ).json()
    client.delete(f"/api/v1/products/{p['id']}")

    items = _trash(client)
    assert len(items) == 1
    assert items[0]["kind"] == "product"
    assert "Wrong Babka" in items[0]["label"]
    assert "24.00" in items[0]["label"]
    assert items[0]["restorable"] is True


def test_a_deleted_product_can_be_put_back(client, make_product):
    p = client.post("/api/v1/products", json={
        "name": "Oops", "price": "31.50", "category": "Cake", "show_on_menu": False,
    }).json()
    client.delete(f"/api/v1/products/{p['id']}")
    assert "Oops" not in _names(client)

    assert client.post(f"/api/v1/trash/{_trash(client)[0]['id']}/restore").status_code == 200

    back = [x for x in client.get("/api/v1/products").json() if x["name"] == "Oops"][0]
    assert Decimal(back["price"]) == Decimal("31.50")
    assert back["category"] == "Cake"
    # The website switch comes back as it was, not reset to the default.
    assert back["show_on_menu"] is False


def test_the_snapshot_records_whether_there_was_a_recipe(client, make_product, make_ingredient):
    """The recipe cascades away with the product and isn't rebuilt, so the
    record has to at least say one existed."""
    p = make_product(name="Had a recipe")
    ing = make_ingredient()
    r = client.post("/api/v1/recipes", json={
        "product_id": p["id"],
        "items": [{"ingredient_id": ing["id"], "quantity": "1.5"}],
    })
    assert r.status_code == 201, r.text

    client.delete(f"/api/v1/products/{p['id']}")
    assert _trash(client)[0]["payload"]["had_recipe"] is True


def test_a_product_with_no_recipe_says_so(client, make_product):
    p = make_product(name="Plain")
    client.delete(f"/api/v1/products/{p['id']}")
    assert _trash(client)[0]["payload"]["had_recipe"] is False


# ---------------------------------------------------------------------------
# permissions and edges
# ---------------------------------------------------------------------------
def test_deleting_an_unknown_product_is_404(client):
    assert client.delete("/api/v1/products/9999").status_code == 404


def test_deleting_needs_the_settings_section(make_user, client, make_product):
    p = make_product(name="Guarded")
    _, _, cashier = make_user("Cashier Cass", "cashier")
    assert cashier.delete(f"/api/v1/products/{p['id']}").status_code == 403
    assert "Guarded" in _names(client)
