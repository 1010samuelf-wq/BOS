"""Loading the baker's item list into the catalog, with edited names."""

from decimal import Decimal

LIST = "products_2026-10"
URL = "/api/v1/product-lists"


def _rows(client):
    return client.get(f"{URL}/{LIST}").json()


def _import(client, rows, apply=False):
    r = client.post(f"{URL}/import", json={"rows": rows, "apply": apply})
    assert r.status_code == 200, r.text
    return r.json()


def _products(client):
    return {p["name"]: p for p in client.get("/api/v1/products").json()}


def test_the_bundled_list_is_offered_with_its_rows(client):
    assert {"name": LIST, "rows": 45} in client.get(URL).json()
    rows = _rows(client)
    rum = next(r for r in rows if r["baker_name"] == "Rum balls")
    assert (rum["name"], rum["price"], rum["category"]) == ("Classic Rum Truffles", "48", "Platters")


def test_preview_writes_nothing(client):
    body = _import(client, _rows(client))
    assert body["applied"] is False
    assert {c["action"] for c in body["changes"]} == {"add"}
    assert _products(client) == {}


def test_the_name_typed_in_is_the_name_saved(client):
    rows = _rows(client)
    rows[0]["name"] = "  Our Famous Coffee Rounds  "
    rows[0]["price"] = "$49.50"
    _import(client, rows, apply=True)

    saved = _products(client)
    assert len(saved) == 45
    p = saved["Our Famous Coffee Rounds"]
    assert Decimal(p["price"]) == Decimal("49.50")
    assert "Espresso Cream Rounds" not in saved


def test_new_products_are_sellable_but_kept_off_the_website(client):
    _import(client, _rows(client)[:1], apply=True)
    p = next(iter(_products(client).values()))
    assert p["active"] is True
    assert p["show_on_menu"] is False
    assert client.get("/api/v1/public/products").json() == []


def test_an_existing_product_under_the_bakers_name_is_renamed_not_duplicated(client, make_product):
    # Rows from before the product was typed in: once it exists the list
    # stops offering that row, but a browser can still send it.
    rows = [r for r in _rows(client) if r["baker_name"] == "Rum balls"]
    old = make_product(name="rum BALLS", price="40.00")

    body = _import(client, rows)
    assert [(c["action"], c["product_id"], c["old_name"]) for c in body["changes"]] == [
        ("update", old["id"], "rum BALLS")
    ]
    _import(client, rows, apply=True)
    saved = _products(client)
    assert list(saved) == ["Classic Rum Truffles"]
    assert saved["Classic Rum Truffles"]["id"] == old["id"]
    assert Decimal(saved["Classic Rum Truffles"]["price"]) == Decimal("48.00")


def test_importing_twice_changes_nothing_the_second_time(client):
    rows = _rows(client)
    _import(client, rows, apply=True)
    again = _import(client, rows)
    assert {c["action"] for c in again["changes"]} == {"unchanged"}


def test_unticked_rows_are_left_out(client):
    rows = _rows(client)[:3]
    rows[1]["include"] = False
    body = _import(client, rows, apply=True)
    assert [c["action"] for c in body["changes"]] == ["add", "excluded", "add"]
    assert len(_products(client)) == 2


def test_bad_rows_are_skipped_with_a_reason(client):
    rows = _rows(client)[:4]
    rows[0]["name"] = "   "
    rows[1]["price"] = "about fifty"
    rows[3]["name"] = rows[2]["name"]
    body = _import(client, rows, apply=True)
    reasons = [(c["action"], c["reason"]) for c in body["changes"]]
    assert reasons[0] == ("skip", "needs a name")
    assert reasons[1] == ("skip", "needs a price, e.g. 48 or 5.50")
    assert reasons[2] == ("skip", "two rows have this name")
    assert reasons[3] == ("skip", "two rows have this name")
    assert _products(client) == {}


def test_unknown_list_is_404(client):
    assert client.get(f"{URL}/nope").status_code == 404
    assert client.get(f"{URL}/..%2F..%2Fconfig").status_code == 404


def test_importing_needs_the_settings_section(make_user, client):
    rows = _rows(client)
    _, _, cashier = make_user("Cashier Cass", "cashier")
    assert cashier.get(URL).status_code == 403
    assert cashier.post(f"{URL}/import", json={"rows": rows, "apply": True}).status_code == 403


# ---------------------------------------------------------------------------
# the list shrinks as rows become products
# ---------------------------------------------------------------------------
def _count(client):
    return next(l["rows"] for l in client.get(URL).json() if l["name"] == LIST)


def test_a_saved_row_leaves_the_list_even_under_a_nicer_name(client):
    rows = _rows(client)
    rum = next(r for r in rows if r["baker_name"] == "Rum balls")
    rum["name"] = "Grandma's Rum Truffles"  # nothing like the baker's name or the suggestion
    _import(client, [rum], apply=True)

    left = _rows(client)
    assert len(left) == 44 and _count(client) == 44
    assert "Rum balls" not in {r["baker_name"] for r in left}
    assert "Grandma's Rum Truffles" in _products(client)


def test_saving_everything_empties_the_list(client):
    _import(client, _rows(client), apply=True)
    assert _rows(client) == [] and _count(client) == 0


def test_a_product_typed_in_by_hand_takes_its_row_off_the_list(client, make_product):
    make_product(name="rum BALLS", price="40.00")
    assert "Rum balls" not in {r["baker_name"] for r in _rows(client)}


def test_a_retired_product_still_counts_as_done(client):
    rum = next(r for r in _rows(client) if r["baker_name"] == "Rum balls")
    _import(client, [rum], apply=True)
    pid = _products(client)[rum["name"]]["id"]
    assert client.put(f"/api/v1/products/{pid}", json={"active": False}).status_code == 200
    assert "Rum balls" not in {r["baker_name"] for r in _rows(client)}


def test_resending_a_row_saved_under_a_nicer_name_updates_it_not_a_duplicate(client):
    """An old browser draft can still send a row that's already a product: it
    must find that product through the baker's name it was saved from."""
    rum = next(r for r in _rows(client) if r["baker_name"] == "Rum balls")
    rum["name"] = "Grandma's Rum Truffles"
    _import(client, [rum], apply=True)

    rum["name"] = "Grandma's Famous Rum Truffles"
    body = _import(client, [rum], apply=True)
    assert [c["action"] for c in body["changes"]] == ["update"]
    assert list(_products(client)) == ["Grandma's Famous Rum Truffles"]
