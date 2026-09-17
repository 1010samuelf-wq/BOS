"""Saved product-email templates.

A template holds the wording *and* the product selection — re-ticking fifteen
products is the tedious part of sending the same email again.

Nothing here sends mail. The dashboard builds the email and the person sends it
from their own mailbox, which is why there is no sending config to test.
"""


def _make(client, **over):
    body = {
        "name": "Rosh Hashanah",
        "subject": "Our holiday selection",
        "intro": "Hi,\n\nHere's what we have.",
        "signoff": "Thank you,\nJust Cake",
        "product_ids": [],
    }
    body.update(over)
    r = client.post("/api/v1/email-templates", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_a_template_remembers_its_products(client, make_product):
    """The whole point — the selection is part of the template."""
    a = make_product(name="Honey cake")["id"]
    b = make_product(name="Round challah")["id"]

    t = _make(client, product_ids=[a, b])
    assert t["product_ids"] == [a, b]

    listed = client.get("/api/v1/email-templates").json()
    assert listed[0]["product_ids"] == [a, b]


def test_the_picked_order_is_preserved(client, make_product):
    """Order matters: it's the order they appear in the email, so the thing
    being pitched can lead."""
    first = make_product(name="Aaa")["id"]
    second = make_product(name="Bbb")["id"]

    t = _make(client, product_ids=[second, first])
    assert t["product_ids"] == [second, first]


def test_the_wording_is_saved_with_it(client):
    t = _make(client)
    assert t["subject"] == "Our holiday selection"
    assert t["intro"].startswith("Hi,")
    assert "Just Cake" in t["signoff"]


def test_a_template_can_be_updated(client, make_product):
    p = make_product()["id"]
    t = _make(client)

    r = client.put(f"/api/v1/email-templates/{t['id']}", json={
        "name": "Rosh Hashanah 2027",
        "subject": "New subject",
        "intro": "Updated",
        "signoff": "Bye",
        "product_ids": [p],
    })
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Rosh Hashanah 2027"
    assert r.json()["product_ids"] == [p]


def test_templates_are_listed_by_name(client):
    _make(client, name="Zaatar")
    _make(client, name="Almond")
    assert [t["name"] for t in client.get("/api/v1/email-templates").json()] == ["Almond", "Zaatar"]


def test_an_empty_selection_is_allowed(client):
    """Someone may want to save wording before choosing products."""
    assert _make(client, product_ids=[])["product_ids"] == []


def test_a_nameless_template_is_refused(client):
    assert client.post("/api/v1/email-templates", json={
        "name": "", "subject": "x", "intro": None, "signoff": None, "product_ids": [],
    }).status_code == 400


def test_updating_an_unknown_template_is_404(client):
    assert client.put("/api/v1/email-templates/9999", json={
        "name": "Ghost", "subject": "", "intro": None, "signoff": None, "product_ids": [],
    }).status_code == 404


# ---------------------------------------------------------------------------
# deleting — to the trash, like everything else
# ---------------------------------------------------------------------------
def test_a_deleted_template_is_kept_and_restorable(client, make_product):
    p = make_product()["id"]
    t = _make(client, name="Seasonal", product_ids=[p])

    assert client.delete(f"/api/v1/email-templates/{t['id']}").status_code == 204
    assert client.get("/api/v1/email-templates").json() == []

    item = client.get("/api/v1/trash").json()[0]
    assert item["kind"] == "email_template"
    assert "Seasonal" in item["label"]
    assert item["restorable"] is True

    assert client.post(f"/api/v1/trash/{item['id']}/restore").status_code == 200
    back = client.get("/api/v1/email-templates").json()
    assert len(back) == 1
    assert back[0]["name"] == "Seasonal"
    # The selection comes back with it, not just the wording.
    assert back[0]["product_ids"] == [p]


# ---------------------------------------------------------------------------
# ids, not a snapshot
# ---------------------------------------------------------------------------
def test_a_template_stores_ids_so_it_sends_todays_prices(client, make_product):
    """Reopening a template should send the current catalog — if a price has
    changed since, the new one goes out."""
    p = make_product(name="Babka", price="24.00")
    t = _make(client, product_ids=[p["id"]])

    client.put(f"/api/v1/products/{p['id']}", json={"price": "27.00"})

    # The template still points at the product; the price comes from the
    # catalog when the email is built.
    assert client.get("/api/v1/email-templates").json()[0]["product_ids"] == [p["id"]]
    current = [x for x in client.get("/api/v1/products").json() if x["id"] == p["id"]][0]
    assert str(current["price"]).startswith("27")


def test_managing_templates_needs_the_orders_section(make_user, client):
    _make(client)
    _, _, nobody = make_user("No Orders Nate", "cashier")
    # A cashier has orders, so grant a user without it a different way: strip
    # the section and confirm the gate bites.
    uid, _, stripped = make_user("Reports Only Rina", "cashier")
    client.put(f"/api/v1/employees/{uid}", json={"permissions": ["reports"]})
    assert stripped.get("/api/v1/email-templates").status_code == 403
    # ...while someone with orders can read them.
    assert nobody.get("/api/v1/email-templates").status_code == 200
