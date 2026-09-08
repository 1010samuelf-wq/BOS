"""Per-product control over what appears on the public website.

`active` used to do two jobs — whether the shop can sell a thing at all, and
whether it shows on justcakeskosher.com — so hiding an item from the website
also pulled it out of staff search and the tap grid. These are now separate.
"""

from tests.conftest import order_payload


def _public_names(client):
    return [p["name"] for p in client.get("/api/v1/public/products").json()]


def test_products_are_on_the_menu_by_default(client, make_product):
    """Existing products must keep appearing — the switch only matters once
    someone turns one off."""
    make_product(name="Chocolate babka")
    assert "Chocolate babka" in _public_names(client)
    assert client.get("/api/v1/products").json()[0]["show_on_menu"] is True


def test_hiding_from_the_menu_leaves_it_sellable_in_the_shop(client, make_product):
    """The whole point: off the website, still on the counter."""
    p = make_product(name="Wholesale trays")
    client.put(f"/api/v1/products/{p['id']}", json={"show_on_menu": False})

    assert "Wholesale trays" not in _public_names(client)
    # ...but staff can still find and sell it.
    assert "Wholesale trays" in [x["name"] for x in client.get("/api/v1/products").json()]
    assert "Wholesale trays" in [
        x["name"] for x in client.get("/api/v1/products/search?q=Wholesale").json()
    ]


def test_a_hidden_product_can_still_be_ordered(client, make_product):
    p = make_product(name="Counter only")
    client.put(f"/api/v1/products/{p['id']}", json={"show_on_menu": False})

    r = client.post("/api/v1/orders", json=order_payload(p["id"], "key-menu-0001"))
    assert r.status_code == 201, r.text


def test_deactivating_still_hides_it_everywhere(client, make_product):
    """`active` keeps its stronger meaning — off the website and off the till."""
    p = make_product(name="Retired item")
    client.put(f"/api/v1/products/{p['id']}", json={"active": False})

    assert "Retired item" not in _public_names(client)
    assert "Retired item" not in [
        x["name"] for x in client.get("/api/v1/products?active=true").json()
    ]


def test_a_product_off_the_menu_but_active_is_hidden_publicly(client, make_product):
    """Both flags are required for public visibility, not either."""
    p = make_product(name="Half hidden")
    client.put(f"/api/v1/products/{p['id']}", json={"show_on_menu": False, "active": True})
    assert "Half hidden" not in _public_names(client)


def test_it_can_be_put_back_on_the_menu(client, make_product):
    p = make_product(name="Seasonal")
    client.put(f"/api/v1/products/{p['id']}", json={"show_on_menu": False})
    assert "Seasonal" not in _public_names(client)

    client.put(f"/api/v1/products/{p['id']}", json={"show_on_menu": True})
    assert "Seasonal" in _public_names(client)


def test_hiding_every_product_in_a_category_drops_the_category(client, make_product):
    """Otherwise the website shows a filter tab that leads nowhere."""
    p = client.post(
        "/api/v1/products", json={"name": "Only babka", "price": "24.00", "category": "Babka"}
    ).json()
    assert "Babka" in client.get("/api/v1/public/categories").json()

    client.put(f"/api/v1/products/{p['id']}", json={"show_on_menu": False})
    assert "Babka" not in client.get("/api/v1/public/categories").json()


def test_toggling_the_menu_flag_does_not_disturb_the_rest(client, make_product):
    p = client.post(
        "/api/v1/products", json={"name": "Cheesecake", "price": "52.00", "category": "Cake"}
    ).json()
    client.put(f"/api/v1/products/{p['id']}", json={"show_on_menu": False})

    after = [x for x in client.get("/api/v1/products").json() if x["id"] == p["id"]][0]
    assert after["name"] == "Cheesecake"
    assert after["category"] == "Cake"
    assert after["active"] is True
    assert str(after["price"]).startswith("52")


def test_the_public_shape_does_not_leak_the_flag(client, make_product):
    """The public payload is deliberately trimmed; internal flags stay internal."""
    make_product(name="Babka")
    public = client.get("/api/v1/public/products").json()[0]
    assert "show_on_menu" not in public
    assert "active" not in public


def test_changing_it_needs_the_settings_section(make_user, client, make_product):
    p = make_product(name="Guarded")
    _, _, cashier = make_user("Cashier Cass", "cashier")
    assert cashier.put(
        f"/api/v1/products/{p['id']}", json={"show_on_menu": False}
    ).status_code == 403
