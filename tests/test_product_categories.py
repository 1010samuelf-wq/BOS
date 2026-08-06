"""Staff-defined product categories.

Categories started as a closed preset list; they're now free text so the shop
can add its own from the product form. These cover that a brand-new category
sticks, shows up in the pickers, and can be filtered on — plus that the preset
list stays first so existing screens don't reshuffle.
"""

from app.schemas.catalog import PRODUCT_CATEGORIES


def test_product_can_be_created_with_a_brand_new_category(client):
    r = client.post(
        "/api/v1/products",
        json={"name": "Babka", "price": "18.00", "category": "Breads"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["category"] == "Breads"


def test_new_category_appears_in_the_picker_after_presets(client):
    client.post("/api/v1/products", json={"name": "Babka", "price": "18.00", "category": "Breads"})

    cats = client.get("/api/v1/products/categories").json()

    assert cats[: len(PRODUCT_CATEGORIES)] == PRODUCT_CATEGORIES
    assert "Breads" in cats


def test_presets_are_offered_even_with_an_empty_catalog(client):
    assert client.get("/api/v1/products/categories").json() == PRODUCT_CATEGORIES


def test_category_is_stripped_so_lookalikes_do_not_split(client):
    client.post("/api/v1/products", json={"name": "Babka", "price": "18.00", "category": "  Breads  "})

    assert client.get("/api/v1/products/categories").json().count("Breads") == 1


def test_products_can_be_filtered_by_category(client):
    client.post("/api/v1/products", json={"name": "Babka", "price": "18.00", "category": "Breads"})
    client.post("/api/v1/products", json={"name": "Tart", "price": "9.00", "category": "Tarts"})

    got = client.get("/api/v1/products", params={"category": "Breads"}).json()

    assert [p["name"] for p in got] == ["Babka"]


def test_category_filter_combines_with_active(client):
    client.post(
        "/api/v1/products",
        json={"name": "Old Babka", "price": "18.00", "category": "Breads", "active": False},
    )
    client.post("/api/v1/products", json={"name": "Babka", "price": "18.00", "category": "Breads"})

    got = client.get("/api/v1/products", params={"category": "Breads", "active": True}).json()

    assert [p["name"] for p in got] == ["Babka"]


def test_a_products_category_can_be_changed_to_a_new_one(client, make_product):
    product = make_product()

    r = client.put(f"/api/v1/products/{product['id']}", json={"category": "Breads"})

    assert r.status_code == 200, r.text
    assert r.json()["category"] == "Breads"


def test_blank_category_is_rejected(client):
    r = client.post("/api/v1/products", json={"name": "Babka", "price": "18.00", "category": "   "})

    assert r.status_code == 400


def test_absurdly_long_category_is_rejected(client):
    r = client.post(
        "/api/v1/products", json={"name": "Babka", "price": "18.00", "category": "x" * 101}
    )

    assert r.status_code == 400


def test_public_menu_lists_new_categories_but_only_from_active_products(client, anon_client):
    client.post("/api/v1/products", json={"name": "Babka", "price": "18.00", "category": "Breads"})
    client.post(
        "/api/v1/products",
        json={"name": "Hidden", "price": "1.00", "category": "Retired", "active": False},
    )

    cats = anon_client.get("/api/v1/public/categories").json()

    assert "Breads" in cats
    assert "Retired" not in cats


def test_cashier_can_read_categories_without_settings_access(make_user):
    """The order screen's category buttons need this list, and cashiers only
    get the `orders` section — not `settings`."""
    _, _, cashier = make_user("cass", "cashier")

    assert cashier.get("/api/v1/products/categories").status_code == 200
