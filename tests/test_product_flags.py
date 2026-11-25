"""Flagging product names: doubles, and names with a number in them."""

from app.services.product_flags import has_number, name_key

URL = "/api/v1/products/flags"


def _flags(client):
    r = client.get(URL)
    assert r.status_code == 200, r.text
    return {f["name"]: f for f in r.json()}


def test_names_that_are_the_same_product():
    assert name_key("Rum Balls") == name_key("rum ball") == name_key(" Rum-Balls! ")
    assert name_key("The Cherry Pies") == name_key("cherry pie")
    assert name_key("Fish & Chips") == name_key("fish and chip")
    assert name_key("Peaches") == name_key("peach")
    assert name_key("Cookies") == name_key("cookie")
    assert name_key("Berries") == name_key("berry")
    assert name_key("Pies") == name_key("pie")
    assert name_key("Babka") != name_key("Chocolate Babka")
    assert name_key("Glass") == "glass"  # not "glas"


def test_numbers():
    assert has_number("Product number 12")
    assert has_number("6 Pack")
    assert not has_number("Challah")


def test_a_quiet_catalog_has_no_flags(client, make_product):
    make_product(name="Challah")
    make_product(name="Chocolate Babka")
    assert client.get(URL).json() == []


def test_doubles_are_flagged_on_both_sides(client, make_product):
    a = make_product(name="Rum Balls")
    b = make_product(name="rum ball")
    make_product(name="Challah")
    flags = _flags(client)
    assert set(flags) == {"Rum Balls", "rum ball"}
    assert flags["Rum Balls"]["reasons"] == ["duplicate"]
    assert flags["Rum Balls"]["duplicate_of"] == [{"id": b["id"], "name": "rum ball"}]
    assert flags["rum ball"]["duplicate_of"] == [{"id": a["id"], "name": "Rum Balls"}]
    assert 'looks like a double of "rum ball"' in flags["Rum Balls"]["message"]


def test_a_number_in_the_name_is_flagged(client, make_product):
    make_product(name="Babka 2")
    flag = _flags(client)["Babka 2"]
    assert flag["reasons"] == ["number"]
    assert flag["message"] == '"Babka 2" has a number in its name'


def test_marking_a_name_fine_clears_it_until_it_is_renamed(client, make_product):
    p = make_product(name="6 Pack Cookies")
    assert "6 Pack Cookies" in _flags(client)
    r = client.put(f"/api/v1/products/{p['id']}", json={"name_ok": True})
    assert r.status_code == 200 and r.json()["name_ok"] is True
    assert _flags(client) == {}
    # A price change keeps the mark; a new name hasn't been looked at.
    client.put(f"/api/v1/products/{p['id']}", json={"price": "9.00"})
    assert _flags(client) == {}
    r = client.put(f"/api/v1/products/{p['id']}", json={"name": "12 Pack Cookies"})
    assert r.json()["name_ok"] is False
    assert "12 Pack Cookies" in _flags(client)


def test_retired_products_are_not_checked(client, make_product):
    make_product(name="Rum Balls")
    old = make_product(name="rum ball")
    client.put(f"/api/v1/products/{old['id']}", json={"active": False})
    assert _flags(client) == {}


def test_flags_show_in_needs_attention(client, make_product):
    make_product(name="Rum Balls")
    make_product(name="rum ball")
    problems = {p["kind"]: p for p in client.get("/api/v1/problems").json()}
    problem = problems["product_name_flags"]
    assert problem["title"] == "2 product names to check"
    assert problem["screen"] == "products"


def test_flags_need_orders_or_settings(make_user, anon_client):
    assert anon_client.get(URL).status_code == 401
    _, _, cashier = make_user("cash", "cashier")
    assert cashier.get(URL).status_code == 200  # orders section
