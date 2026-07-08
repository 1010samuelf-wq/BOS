"""Product typeahead search + business-profile settings (§2A/§5, §2I/§4)."""


def test_product_search_ranks_prefix_first(client, make_product):
    make_product(name="Croissant", price="3.50")
    make_product(name="Chocolate Croissant", price="4.50")
    make_product(name="Macaron", price="2.00")

    results = client.get("/api/v1/products/search", params={"q": "cro"}).json()
    names = [r["name"] for r in results]
    # both croissants match "cro"; the prefix match ("Croissant") ranks first
    assert names[0] == "Croissant"
    assert "Chocolate Croissant" in names
    assert "Macaron" not in names


def test_product_search_excludes_inactive(client, make_product):
    p = make_product(name="Danish", price="3.00")
    make_product(name="Danish Ring", price="6.00")
    client.put(f"/api/v1/products/{p['id']}", json={"active": False})

    names = [r["name"] for r in client.get(
        "/api/v1/products/search", params={"q": "danish"}).json()]
    assert names == ["Danish Ring"]  # inactive Danish filtered out


def test_product_search_requires_auth(anon_client):
    assert anon_client.get("/api/v1/products/search", params={"q": "x"}).status_code == 401


def test_recipe_yield_defaults_and_persists(client, make_product, make_ingredient):
    p = make_product(name="Cupcake batch")
    flour = make_ingredient(name="Flour")

    # default yield is 1 when omitted
    r = client.post("/api/v1/recipes", json={
        "product_id": p["id"], "items": [{"ingredient_id": flour["id"], "quantity": "2"}]})
    assert r.status_code == 201
    assert r.json()["yield_qty"] == 1

    # upsert with an explicit yield (e.g. 24 cupcakes per batch)
    r = client.post("/api/v1/recipes", json={
        "product_id": p["id"], "yield_qty": 24,
        "items": [{"ingredient_id": flour["id"], "quantity": "2"}]})
    assert r.status_code == 201
    assert r.json()["yield_qty"] == 24
    assert client.get(f"/api/v1/recipes/{p['id']}").json()["yield_qty"] == 24


def test_ingredient_active_default_and_deactivate(client, make_ingredient):
    ing = make_ingredient(name="Butter")
    assert ing["active"] is True  # new ingredients are active by default

    r = client.put(f"/api/v1/ingredients/{ing['id']}", json={"active": False})
    assert r.status_code == 200
    assert r.json()["active"] is False


def test_ingredient_active_filter(client, make_ingredient):
    keep = make_ingredient(name="Sugar")
    gone = make_ingredient(name="Old Spice")
    client.put(f"/api/v1/ingredients/{gone['id']}", json={"active": False})

    active = [i["name"] for i in client.get(
        "/api/v1/ingredients", params={"active": True}).json()]
    assert keep["name"] in active
    assert gone["name"] not in active

    inactive = [i["name"] for i in client.get(
        "/api/v1/ingredients", params={"active": False}).json()]
    assert inactive == [gone["name"]]

    # unfiltered returns both
    allnames = [i["name"] for i in client.get("/api/v1/ingredients").json()]
    assert {keep["name"], gone["name"]} <= set(allnames)


def test_business_profile_get_default_then_update(client):
    # defaults are null until set
    r = client.get("/api/v1/settings/business-profile").json()
    assert r["business_name"] is None

    r = client.put("/api/v1/settings/business-profile", json={
        "business_name": "Sunrise Bakery",
        "business_address": "1 Flour Lane",
        "business_phone": "555-0100",
    })
    assert r.status_code == 200
    assert r.json()["business_name"] == "Sunrise Bakery"

    # persisted
    assert client.get("/api/v1/settings/business-profile").json()["business_phone"] == "555-0100"


def test_business_profile_gated_by_settings_section(client, make_user):
    _, _, manager = make_user("rhea", "manager")
    # settings is not in a manager's default sections → both read and write 403
    assert manager.get("/api/v1/settings/business-profile").status_code == 403
    assert manager.put(
        "/api/v1/settings/business-profile", json={"business_name": "X"}
    ).status_code == 403
