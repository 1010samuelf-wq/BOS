"""Public menu (justcakeskosher.com) + staff inquiry inbox.

Public endpoints (`/public/*`) take no auth at all — that's the point, a
customer browsing the menu isn't a BOS user. They can only read active
products and create an Inquiry; nothing else. The staff inbox (`/inquiries`)
is gated the same as Orders.
"""


def test_public_products_lists_only_active(anon_client, make_product):
    make_product(name="Croissant", price="3.50", active=True)
    make_product(name="Discontinued Item", price="9.99", active=False)

    r = anon_client.get("/api/v1/public/products")
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert "Croissant" in names
    assert "Discontinued Item" not in names
    # trimmed shape — no `active` field leaked
    assert "active" not in r.json()[0]


def test_public_categories_returns_fixed_preset(anon_client):
    r = anon_client.get("/api/v1/public/categories")
    assert r.status_code == 200
    assert r.json() == [
        "Pareve Miniatures", "Pareve Cakes", "Dairy Miniatures", "Dairy Cakes", "Tarts", "Seasonal",
    ]


def test_public_products_filters_by_category(client, anon_client, make_product):
    make_product(name="Croissant", price="3.50")  # left uncategorized
    tart = make_product(name="Apple Tart", price="8.00")
    client.put(f"/api/v1/products/{tart['id']}", json={"category": "Tarts"})

    r = anon_client.get("/api/v1/public/products", params={"category": "Tarts"})
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert names == ["Apple Tart"]


# Categories used to be a closed preset and this file asserted anything else was
# rejected. They're staff-editable now — see tests/test_product_categories.py.


def test_public_contact_returns_business_phone(client, anon_client):
    client.put("/api/v1/settings/business-profile", json={
        "business_name": "Just Cake", "business_phone": "555-0100",
    })
    r = anon_client.get("/api/v1/public/contact")
    assert r.status_code == 200
    assert r.json() == {"business_name": "Just Cake", "business_phone": "555-0100"}


def test_submit_inquiry_creates_snapshot_and_no_auth_needed(anon_client, make_product):
    cake = make_product(name="Carrot Cake", price="20.00")
    r = anon_client.post("/api/v1/public/inquiries", json={
        "customer_name": "Jane Doe",
        "customer_phone": "555-1234",
        "note": "Nut allergy",
        "items": [{"product_id": cake["id"], "quantity": 2}],
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["customer_name"] == "Jane Doe"
    assert body["handled"] is False
    assert body["items"] == [{
        "product_id": cake["id"], "product_name": "Carrot Cake",
        "unit_price": "20.00", "quantity": 2,
    }]


def test_submit_inquiry_rejects_unknown_or_inactive_product(anon_client, make_product):
    inactive = make_product(name="Gone", price="5.00", active=False)
    r = anon_client.post("/api/v1/public/inquiries", json={
        "customer_name": "Sam", "customer_phone": "555-0000",
        "items": [{"product_id": inactive["id"], "quantity": 1}],
    })
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "unknown_product"

    r = anon_client.post("/api/v1/public/inquiries", json={
        "customer_name": "Sam", "customer_phone": "555-0000",
        "items": [{"product_id": 999999, "quantity": 1}],
    })
    assert r.status_code == 400


def test_submit_inquiry_requires_at_least_one_item(anon_client):
    r = anon_client.post("/api/v1/public/inquiries", json={
        "customer_name": "Sam", "customer_phone": "555-0000", "items": [],
    })
    assert r.status_code == 400


def test_staff_inbox_requires_auth_and_lists_newest_first(client, anon_client, make_product):
    assert anon_client.get("/api/v1/inquiries").status_code == 401

    cake = make_product(name="Cake")
    anon_client.post("/api/v1/public/inquiries", json={
        "customer_name": "A", "customer_phone": "1",
        "items": [{"product_id": cake["id"], "quantity": 1}],
    })
    anon_client.post("/api/v1/public/inquiries", json={
        "customer_name": "B", "customer_phone": "2",
        "items": [{"product_id": cake["id"], "quantity": 1}],
    })

    r = client.get("/api/v1/inquiries")
    assert r.status_code == 200
    names = [i["customer_name"] for i in r.json()]
    assert names == ["B", "A"]  # newest first


def test_mark_handled_toggles_and_stamps_who(client, anon_client, make_product):
    cake = make_product(name="Cake")
    anon_client.post("/api/v1/public/inquiries", json={
        "customer_name": "A", "customer_phone": "1",
        "items": [{"product_id": cake["id"], "quantity": 1}],
    })
    iid = client.get("/api/v1/inquiries").json()[0]["id"]

    r = client.post(f"/api/v1/inquiries/{iid}/handled")
    assert r.status_code == 200
    body = r.json()
    assert body["handled"] is True
    assert body["handled_by"] is not None
    assert body["handled_at"] is not None

    r = client.post(f"/api/v1/inquiries/{iid}/handled")
    assert r.json()["handled"] is False
    assert r.json()["handled_by"] is None


def test_cashier_without_orders_section_cannot_see_inbox(client, make_user):
    _, _, cashier = make_user("nora", "cashier")
    client.put(f"/api/v1/employees/{_id_of(client, 'nora')}", json={"permissions": ["stock"]})
    assert cashier.get("/api/v1/inquiries").status_code == 403


def _id_of(client, name):
    return next(e["id"] for e in client.get("/api/v1/employees").json() if e["name"] == name)
