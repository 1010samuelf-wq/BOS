"""Recording how a customer says they'll pay, before they pay.

The shop's ask: "mark which payment method the person will use even before
marking as paid, so we know and we can expect how the person will pay."

Kept separate from payment_method on purpose. That column means "how it was
actually settled" and feeds the reports' cash/card/e-transfer breakdown, so
filling it early would have the reports counting money nobody handed over.
"""

from decimal import Decimal

from tests.conftest import order_payload


def _unpaid(client, product_id, key, **extra):
    payload = order_payload(product_id, key, payment_timing="later")
    payload.pop("payment_method", None)
    payload.update(extra)
    r = client.post("/api/v1/orders", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_an_unpaid_order_can_say_how_it_will_be_paid(client, make_product):
    p = make_product()["id"]
    order = _unpaid(client, p, "key-exp-0001", expected_payment_method="cash")

    assert order["expected_payment_method"] == "cash"
    # ...and it is still unpaid, with nothing claimed about actual money.
    assert order["paid_status"] == "unpaid"
    assert order["payment_method"] is None


def test_it_is_optional(client, make_product):
    p = make_product()["id"]
    order = _unpaid(client, p, "key-exp-0002")
    assert order["expected_payment_method"] is None


def test_it_can_be_set_later_by_editing(client, make_product):
    """The customer often says it on the phone after the order was taken."""
    p = make_product()["id"]
    order = _unpaid(client, p, "key-exp-0003")

    r = client.put(f"/api/v1/orders/{order['id']}", json={"expected_payment_method": "etransfer"})
    assert r.status_code == 200, r.text
    assert r.json()["expected_payment_method"] == "etransfer"


def test_editing_it_does_not_disturb_the_rest_of_the_order(client, make_product):
    p = make_product()["id"]
    order = _unpaid(client, p, "key-exp-0004", client_name="Rivka Cohen")

    client.put(f"/api/v1/orders/{order['id']}", json={"expected_payment_method": "card"})
    after = client.get(f"/api/v1/orders/{order['id']}").json()
    assert after["client_name"] == "Rivka Cohen"
    assert Decimal(after["total"]) == Decimal(order["total"])
    assert len(after["items"]) == len(order["items"])


def test_it_can_be_cleared(client, make_product):
    p = make_product()["id"]
    order = _unpaid(client, p, "key-exp-0005", expected_payment_method="cash")

    r = client.put(f"/api/v1/orders/{order['id']}", json={"expected_payment_method": None})
    assert r.json()["expected_payment_method"] is None


# ---------------------------------------------------------------------------
# the payoff: marking paid
# ---------------------------------------------------------------------------
def test_marking_paid_falls_back_to_what_was_expected(client, make_product):
    """The common case — said cash, paid cash — shouldn't need re-entering."""
    p = make_product()["id"]
    order = _unpaid(client, p, "key-exp-0006", expected_payment_method="cash")

    r = client.post(f"/api/v1/orders/{order['id']}/mark-paid", json={})
    assert r.status_code == 200, r.text
    assert r.json()["paid_status"] == "paid"
    assert r.json()["payment_method"] == "cash"


def test_an_explicit_method_beats_the_expectation(client, make_product):
    """Changed their mind at the counter: what actually happened wins, and the
    expectation is left alone so the mismatch stays visible."""
    p = make_product()["id"]
    order = _unpaid(client, p, "key-exp-0007", expected_payment_method="cash")

    r = client.post(f"/api/v1/orders/{order['id']}/mark-paid", json={"payment_method": "card"})
    body = r.json()
    assert body["payment_method"] == "card"
    assert body["expected_payment_method"] == "cash"


def test_no_expectation_and_no_method_leaves_it_unset(client, make_product):
    p = make_product()["id"]
    order = _unpaid(client, p, "key-exp-0008")

    r = client.post(f"/api/v1/orders/{order['id']}/mark-paid", json={})
    assert r.json()["paid_status"] == "paid"
    assert r.json()["payment_method"] is None


def test_the_expectation_alone_does_not_make_an_order_paid(client, make_product):
    """It's a note about the future — it must not touch revenue."""
    p = make_product()["id"]
    _unpaid(client, p, "key-exp-0009", expected_payment_method="cash")

    report = client.get("/api/v1/reports/daily").json()
    assert Decimal(report["revenue"]) == Decimal("0")


def test_an_expectation_does_not_land_in_the_payment_breakdown(client, make_product):
    """Reports are cash-basis; an expected method is not a collected one."""
    p = make_product(price="50.00")["id"]
    _unpaid(client, p, "key-exp-0010", expected_payment_method="cash")

    breakdown = client.get("/api/v1/reports/daily").json()["payment_breakdown"]
    assert Decimal(breakdown["cash"]) == Decimal("0")


def test_it_reaches_the_breakdown_only_once_actually_paid(client, make_product):
    p = make_product(price="50.00")["id"]
    order = _unpaid(client, p, "key-exp-0011", expected_payment_method="cash")
    client.post(f"/api/v1/orders/{order['id']}/mark-paid", json={})

    breakdown = client.get("/api/v1/reports/daily").json()["payment_breakdown"]
    # Against the order's own total, not a hand-typed figure — the quantity in
    # the shared payload fixture is not this test's business.
    assert Decimal(breakdown["cash"]) == Decimal(order["total"])
    assert Decimal(breakdown["cash"]) > 0


def test_a_pay_now_order_is_unaffected(client, make_product):
    """Paying now still requires a real method and still records it."""
    p = make_product()["id"]
    r = client.post("/api/v1/orders", json=order_payload(p, "key-exp-0012"))
    body = r.json()
    assert body["paid_status"] == "paid"
    assert body["payment_method"] is not None
