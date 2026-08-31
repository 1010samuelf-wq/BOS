"""Customers.

The point of the feature is that one person is one record even when their name
is typed three different ways, so most of these tests are about *not* creating
a second customer — and about refusing to guess when guessing would attach an
order to a stranger.
"""

from tests.conftest import order_payload


def _order(client, product_id, key, name, phone=None, **over):
    payload = order_payload(product_id, key, client_name=name, **over)
    payload["client_phone"] = phone
    if payload.get("payment_timing") == "later":
        payload.pop("payment_method", None)
    r = client.post("/api/v1/orders", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _customers(client, q=None):
    url = "/api/v1/customers" + (f"?q={q}" if q else "")
    return client.get(url).json()


# ---------------------------------------------------------------------------
# one person, one record
# ---------------------------------------------------------------------------
def test_orders_from_the_same_phone_share_one_customer(client, make_product):
    """Different spelling, different phone formatting, same person."""
    p = make_product()["id"]
    _order(client, p, "key-cust-1", "Weiss Catering", "514-272-0105")
    _order(client, p, "key-cust-2", "weiss catering", "(514) 272 0105")

    matches = [c for c in _customers(client) if "eiss" in c["name"].lower()]
    assert len(matches) == 1


def test_a_phoneless_repeat_joins_the_existing_customer(client, make_product):
    p = make_product()["id"]
    _order(client, p, "key-cust-3", "Rivka Cohen", "5149998888")
    _order(client, p, "key-cust-4", "  rivka   cohen ", None)

    matches = [c for c in _customers(client) if "rivka" in c["name"].lower()]
    assert len(matches) == 1


def test_two_people_sharing_a_name_stay_separate(client, make_product):
    """Different phones means different people, however similar the name."""
    p = make_product()["id"]
    _order(client, p, "key-cust-5", "Sara Klein", "5140000001")
    _order(client, p, "key-cust-6", "Sara Klein", "5140000002")

    assert len([c for c in _customers(client) if c["name"] == "Sara Klein"]) == 2


def test_a_phoneless_order_is_not_guessed_onto_an_ambiguous_name(client, make_product):
    """With two Sara Kleins on file, a phone-less order for that name must not
    be attached to either — a spurious duplicate is recoverable, silently
    filing an order under a stranger is not."""
    p = make_product()["id"]
    _order(client, p, "key-cust-7", "Sara Klein", "5140000001")
    _order(client, p, "key-cust-8", "Sara Klein", "5140000002")
    _order(client, p, "key-cust-9", "Sara Klein", None)

    assert len([c for c in _customers(client) if c["name"] == "Sara Klein"]) == 3


def test_the_order_keeps_its_own_snapshot_of_the_name(client, make_product):
    """Correcting a customer's name must not rewrite what past orders said —
    the same rule order items follow for product name and price."""
    p = make_product()["id"]
    order = _order(client, p, "key-cust-10", "wiess ctering", "5145550000")
    customer_id = _customers(client, "wiess")[0]["id"]

    client.put(f"/api/v1/customers/{customer_id}", json={"name": "Weiss Catering"})

    assert client.get(f"/api/v1/orders/{order['id']}").json()["client_name"] == "wiess ctering"
    assert client.get(f"/api/v1/customers/{customer_id}").json()["name"] == "Weiss Catering"


# ---------------------------------------------------------------------------
# search
# ---------------------------------------------------------------------------
def test_search_finds_by_name_or_phone_ignoring_formatting(client, make_product):
    p = make_product()["id"]
    _order(client, p, "key-cust-11", "Chaya Blum", "(514) 777-1234")

    assert _customers(client, "chaya")[0]["name"] == "Chaya Blum"
    assert _customers(client, "5147771234")[0]["name"] == "Chaya Blum"
    assert _customers(client, "777")[0]["name"] == "Chaya Blum"


def test_search_with_no_term_lists_everyone(client, make_product):
    p = make_product()["id"]
    _order(client, p, "key-cust-12", "Aaa Person", "5140001111")
    _order(client, p, "key-cust-13", "Bbb Person", "5140002222")

    assert len(_customers(client)) >= 2


# ---------------------------------------------------------------------------
# history and totals
# ---------------------------------------------------------------------------
def test_history_shows_past_orders_and_lifetime_value(client, make_product):
    p = make_product(price="25.00")["id"]
    _order(client, p, "key-cust-14", "Repeat Rina", "5145551111",
           payment_timing="now", payment_method="cash")
    _order(client, p, "key-cust-15", "Repeat Rina", "5145551111",
           payment_timing="now", payment_method="cash")

    customer_id = _customers(client, "Rina")[0]["id"]
    detail = client.get(f"/api/v1/customers/{customer_id}").json()

    assert detail["order_count"] == 2
    assert detail["lifetime_value"] == "100.00"   # 2 orders x 2 units x 25.00
    assert len(detail["orders"]) == 2
    assert "Croissant" in detail["orders"][0]["items"]


def test_lifetime_value_is_cash_basis(client, make_product):
    """Unpaid orders appear in the history but must not count as money in —
    every other figure in this system works that way."""
    p = make_product(price="25.00")["id"]
    _order(client, p, "key-cust-16", "Owes Us Otto", "5145552222", payment_timing="later")

    customer_id = _customers(client, "Otto")[0]["id"]
    detail = client.get(f"/api/v1/customers/{customer_id}").json()

    assert len(detail["orders"]) == 1     # visible in history
    assert detail["order_count"] == 0     # ...but not counted as revenue
    assert detail["lifetime_value"] == "0.00"


# ---------------------------------------------------------------------------
# merging duplicates
# ---------------------------------------------------------------------------
def test_merging_moves_orders_and_removes_the_duplicate(client, make_product):
    p = make_product()["id"]
    _order(client, p, "key-cust-17", "Dov Katz", "5140009999")
    _order(client, p, "key-cust-18", "D. Katz", "5140008888")   # same person, both typed

    dov = [c for c in _customers(client) if c["name"] == "Dov Katz"][0]
    dupe = [c for c in _customers(client) if c["name"] == "D. Katz"][0]

    merged = client.post(f"/api/v1/customers/{dov['id']}/merge",
                         json={"source_id": dupe["id"]})
    assert merged.status_code == 200
    assert len(merged.json()["orders"]) == 2

    assert client.get(f"/api/v1/customers/{dupe['id']}").status_code == 404


def test_merging_a_customer_into_itself_is_refused(client, make_product):
    p = make_product()["id"]
    _order(client, p, "key-cust-19", "Solo Sol", "5140007777")
    sol = _customers(client, "Solo")[0]

    r = client.post(f"/api/v1/customers/{sol['id']}/merge", json={"source_id": sol["id"]})
    assert r.status_code == 400


def test_a_cashier_can_look_customers_up_but_not_edit_them(make_user, client, make_product):
    """Taking an order needs the lookup; a bad merge mid-rush does not."""
    p = make_product()["id"]
    _order(client, p, "key-cust-20", "Edit Me", "5140006666")
    target = _customers(client, "Edit")[0]

    _, _, cashier = make_user("Cashier Cass", "cashier")
    assert cashier.get("/api/v1/customers").status_code == 200
    assert cashier.put(f"/api/v1/customers/{target['id']}",
                       json={"name": "Nope"}).status_code == 403
    assert cashier.post(f"/api/v1/customers/{target['id']}/merge",
                        json={"source_id": 999}).status_code == 403


def test_customers_require_authentication(anon_client):
    assert anon_client.get("/api/v1/customers").status_code == 401


# ---------------------------------------------------------------------------
# ordering on someone else's behalf (the party-planner case)
# ---------------------------------------------------------------------------
def test_a_planner_is_one_customer_with_who_each_order_was_for(client, make_product):
    """The real case this exists for: one planner, one customer record, and the
    end client recorded per order instead of being smuggled into the name."""
    p = make_product()["id"]
    _order(client, p, "key-cust-21", "Herman", "4383705825", for_whom="Srugo")
    _order(client, p, "key-cust-22", "Herman", "4383705825", for_whom="Frankl")

    matches = [c for c in _customers(client) if c["name"] == "Herman"]
    assert len(matches) == 1              # one customer, not one per party

    detail = client.get(f"/api/v1/customers/{matches[0]['id']}").json()
    assert sorted(o["for_whom"] for o in detail["orders"]) == ["Frankl", "Srugo"]


def test_for_whom_survives_a_round_trip_on_the_order(client, make_product):
    p = make_product()["id"]
    order = _order(client, p, "key-cust-23", "Herman", "4383705825", for_whom="Weiss bar mitzvah")
    assert client.get(f"/api/v1/orders/{order['id']}").json()["for_whom"] == "Weiss bar mitzvah"


# ---------------------------------------------------------------------------
# splitting people the matching folded together
# ---------------------------------------------------------------------------
def test_an_order_can_be_moved_to_another_customer(client, make_product):
    """The undo for a wrong automatic match: two people sharing a household
    phone get folded together, and merge can only combine — this separates."""
    p = make_product()["id"]
    _order(client, p, "key-cust-24", "Household One", "5140005555")
    second = _order(client, p, "key-cust-25", "Household Two", "5140005555")

    # Both landed on one customer, because they share the number.
    folded = [c for c in _customers(client) if c["phone"] == "5140005555"]
    assert len(folded) == 1
    assert len(client.get(f"/api/v1/customers/{folded[0]['id']}").json()["orders"]) == 2

    # Split them: make a record for the second person and move their order.
    other = client.post("/api/v1/customers",
                        json={"name": "Household Two", "phone": "514 000 5556"}).json()
    moved = client.post(f"/api/v1/customers/{other['id']}/orders",
                        json={"order_id": second["id"]})
    assert moved.status_code == 200
    assert [o["id"] for o in moved.json()["orders"]] == [second["id"]]
    assert len(client.get(f"/api/v1/customers/{folded[0]['id']}").json()["orders"]) == 1


def test_reassigning_leaves_the_orders_own_snapshot_alone(client, make_product):
    p = make_product()["id"]
    order = _order(client, p, "key-cust-26", "Typed This Way", "5140004444")
    other = client.post("/api/v1/customers", json={"name": "Correct Name"}).json()

    client.post(f"/api/v1/customers/{other['id']}/orders", json={"order_id": order["id"]})

    assert client.get(f"/api/v1/orders/{order['id']}").json()["client_name"] == "Typed This Way"


def test_reassigning_to_a_missing_customer_is_404(client, make_product):
    p = make_product()["id"]
    order = _order(client, p, "key-cust-27", "Someone", "5140003333")
    assert client.post("/api/v1/customers/9999/orders",
                       json={"order_id": order["id"]}).status_code == 404


def test_a_cashier_cannot_reassign_orders(make_user, client, make_product):
    p = make_product()["id"]
    order = _order(client, p, "key-cust-28", "Someone Else", "5140002222")
    target = _customers(client, "Someone Else")[0]
    _, _, cashier = make_user("Cashier Cal", "cashier")

    assert cashier.post(f"/api/v1/customers/{target['id']}/orders",
                        json={"order_id": order["id"]}).status_code == 403
