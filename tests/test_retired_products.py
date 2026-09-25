"""Retiring a product moves it, it doesn't lose it.

The Settings catalog now asks for `active=true` and the Deleted page asks for
`active=false`. Between them they have to account for every product: if either
filter leaked, a retired product would show up in both places or — worse —
neither, and the only way to sell it again would be a hand-written API call.
"""


def _names(client, **params):
    r = client.get("/api/v1/products", params=params)
    assert r.status_code == 200, r.text
    return {p["name"] for p in r.json()}


def _retire(client, product_id, retired=True):
    r = client.put(f"/api/v1/products/{product_id}", json={"active": not retired})
    assert r.status_code == 200, r.text
    return r.json()


def test_retiring_moves_a_product_between_the_two_lists(client, make_product):
    keep = make_product(name="Chocolate babka", price="24.00")
    drop = make_product(name="Summer tart", price="42.00")

    assert _names(client, active=True) == {"Chocolate babka", "Summer tart"}
    assert _names(client, active=False) == set()

    _retire(client, drop["id"])

    assert _names(client, active=True) == {"Chocolate babka"}
    assert _names(client, active=False) == {"Summer tart"}
    assert keep["active"] is True


def test_putting_one_back_returns_it_to_the_catalog(client, make_product):
    p = make_product(name="Summer tart", price="42.00")
    _retire(client, p["id"])
    assert _names(client, active=False) == {"Summer tart"}

    back = _retire(client, p["id"], retired=False)

    assert back["active"] is True
    assert _names(client, active=True) == {"Summer tart"}
    assert _names(client, active=False) == set()


def test_the_two_lists_partition_the_catalog(client, make_product):
    """No product in both lists, none in neither — the property the UI relies on."""
    made = {make_product(name=f"Item {i}", price="5.00")["id"]: f"Item {i}" for i in range(5)}
    for pid in list(made)[:2]:
        _retire(client, pid)

    selling = _names(client, active=True)
    retired = _names(client, active=False)
    everything = _names(client)

    assert selling & retired == set(), "a product is in both lists"
    assert selling | retired == everything, "a product is in neither list"
    assert everything == set(made.values())
    assert len(retired) == 2


def test_a_retired_product_stays_out_of_search(client, make_product):
    """The catalog isn't the only place it has to leave — search feeds new orders."""
    p = make_product(name="Summer tart", price="42.00")
    _retire(client, p["id"])

    found = client.get("/api/v1/products/search", params={"q": "tart"}).json()
    assert found == []


def test_retiring_is_not_deleting(client, make_product):
    """It keeps its id and its row, so order history still resolves."""
    p = make_product(name="Summer tart", price="42.00")
    _retire(client, p["id"])

    rows = [x for x in client.get("/api/v1/products").json() if x["id"] == p["id"]]
    assert len(rows) == 1
    assert rows[0]["active"] is False
    assert rows[0]["price"] == "42.00"
