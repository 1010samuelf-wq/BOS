"""Deposits and part-payments.

The shop's own example: a $400 order, $100 taken when it's booked and $300 on
collection. The whole point is *when* each amount counts, so most of these
tests are about dates rather than totals — reports are cash-basis, and the two
amounts are income on two different days.
"""

from datetime import date, timedelta
from decimal import Decimal

from tests.conftest import order_payload


def _order(client, product_id, key, **over):
    payload = order_payload(product_id, key, **over)
    payload["payment_timing"] = "later"
    payload.pop("payment_method", None)
    r = client.post("/api/v1/orders", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _pay(client, order_id, amount, **body):
    return client.post(
        f"/api/v1/orders/{order_id}/payments", json={"amount": amount, **body}
    )


def _report(client, on):
    day = on.isoformat()
    r = client.get("/api/v1/reports/summary", params={"from": day, "to": day})
    assert r.status_code == 200, r.text
    return r.json()


def _get(client, order_id):
    return client.get(f"/api/v1/orders/{order_id}").json()


# ---- the arithmetic --------------------------------------------------------
def test_a_deposit_leaves_a_balance(client, make_product):
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0001", items=[{"product_id": p, "quantity": 1}])

    out = _pay(client, order["id"], "100.00", method="cash").json()

    assert Decimal(out["amount_paid"]) == Decimal("100.00")
    assert Decimal(out["balance_due"]) == Decimal("300.00")
    # Still unpaid: money is owed. The tablet prints this field verbatim and
    # treats anything else as settled, so "unpaid" is the only safe answer.
    assert out["paid_status"] == "unpaid"


def test_paying_the_balance_settles_the_order(client, make_product):
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0002", items=[{"product_id": p, "quantity": 1}])
    _pay(client, order["id"], "100.00", method="cash")

    out = _pay(client, order["id"], "300.00", method="card").json()

    assert out["paid_status"] == "paid"
    assert Decimal(out["balance_due"]) == Decimal("0.00")
    assert out["paid_at"] is not None
    assert len(out["payments"]) == 2


def test_many_small_payments_add_up_exactly(client, make_product):
    """Cents must not drift — three 33.33s and a 0.01 is exactly 100."""
    p = make_product(price="100.00")["id"]
    order = _order(client, p, "key-dep-0003", items=[{"product_id": p, "quantity": 1}])

    for amount in ("33.33", "33.33", "33.33", "0.01"):
        assert _pay(client, order["id"], amount).status_code == 200

    out = _get(client, order["id"])
    assert Decimal(out["amount_paid"]) == Decimal("100.00")
    assert Decimal(out["balance_due"]) == Decimal("0.00")
    assert out["paid_status"] == "paid"


def test_overpaying_is_refused_with_the_balance_named(client, make_product):
    """Almost always a typo, and there is no refund concept to absorb it."""
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0004", items=[{"product_id": p, "quantity": 1}])
    _pay(client, order["id"], "100.00")

    r = _pay(client, order["id"], "500.00")

    assert r.status_code == 400
    assert "300" in r.json()["error"]["message"]
    # Nothing banked.
    assert Decimal(_get(client, order["id"])["amount_paid"]) == Decimal("100.00")


def test_a_zero_or_negative_payment_is_refused(client, make_product):
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0005", items=[{"product_id": p, "quantity": 1}])

    assert _pay(client, order["id"], "0").status_code == 400
    assert _pay(client, order["id"], "-50.00").status_code == 400


# ---- the dates, which is the whole point ----------------------------------
def test_each_payment_counts_on_the_day_it_arrived(client, make_product):
    """The shop's example: $100 today, $300 on collection next week."""
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0006", items=[{"product_id": p, "quantity": 1}])
    today = date.today()
    later = today + timedelta(days=7)

    _pay(client, order["id"], "100.00", method="cash", received_on=today.isoformat())
    _pay(client, order["id"], "300.00", method="cash", received_on=later.isoformat())

    assert Decimal(_report(client, today)["revenue"]) == Decimal("100.00")
    assert Decimal(_report(client, later)["revenue"]) == Decimal("300.00")


def test_the_deposit_is_not_counted_twice_when_the_balance_is_paid(client, make_product):
    """The trap in moving recognition onto payments: the order total must never
    be booked again on top of the instalments."""
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0007", items=[{"product_id": p, "quantity": 1}])
    today = date.today()

    _pay(client, order["id"], "100.00", method="cash", received_on=today.isoformat())
    _pay(client, order["id"], "300.00", method="cash", received_on=today.isoformat())

    assert Decimal(_report(client, today)["revenue"]) == Decimal("400.00")


def test_a_payment_entered_late_lands_on_the_day_it_was_taken(client, make_product):
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0008", items=[{"product_id": p, "quantity": 1}])
    yesterday = date.today() - timedelta(days=1)

    _pay(client, order["id"], "400.00", method="cash", received_on=yesterday.isoformat())

    assert Decimal(_report(client, yesterday)["revenue"]) == Decimal("400.00")
    assert Decimal(_report(client, date.today())["revenue"]) == Decimal("0.00")


def test_a_payment_defaults_to_today(client, make_product):
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0009", items=[{"product_id": p, "quantity": 1}])

    out = _pay(client, order["id"], "100.00").json()

    assert out["payments"][0]["received_on"] == date.today().isoformat()


def test_the_outstanding_bucket_is_only_what_is_still_owed(client, make_product):
    """A part-paid order must not show its whole total as unpaid, or the figure
    double-counts money already banked as revenue."""
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0010", items=[{"product_id": p, "quantity": 1}])
    _pay(client, order["id"], "100.00", method="cash")

    report = _report(client, date.today())
    assert Decimal(report["payment_breakdown"]["unpaid"]) == Decimal("300.00")
    assert Decimal(report["payment_breakdown"]["cash"]) == Decimal("100.00")


def test_a_split_order_is_counted_under_each_method(client, make_product):
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0011", items=[{"product_id": p, "quantity": 1}])

    _pay(client, order["id"], "100.00", method="cash")
    _pay(client, order["id"], "300.00", method="card")

    breakdown = _report(client, date.today())["payment_breakdown"]
    assert Decimal(breakdown["cash"]) == Decimal("100.00")
    assert Decimal(breakdown["card"]) == Decimal("300.00")


# ---- mark-paid still works, and now accounts for the deposit --------------
def test_mark_paid_settles_only_the_remaining_balance(client, make_product):
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0012", items=[{"product_id": p, "quantity": 1}])
    _pay(client, order["id"], "100.00", method="cash")

    out = client.post(f"/api/v1/orders/{order['id']}/mark-paid", json={}).json()

    assert out["paid_status"] == "paid"
    assert Decimal(out["amount_paid"]) == Decimal("400.00")
    # Not 400 on top of 100: the deposit is accounted for, so only 300 was added.
    amounts = [Decimal(x["amount"]) for x in out["payments"]]
    assert amounts == [Decimal("100.00"), Decimal("300.00")]
    assert Decimal(_report(client, date.today())["revenue"]) == Decimal("400.00")


def test_mark_paid_on_a_fully_paid_order_is_still_refused(client, make_product):
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0013", items=[{"product_id": p, "quantity": 1}])
    _pay(client, order["id"], "400.00")

    r = client.post(f"/api/v1/orders/{order['id']}/mark-paid", json={})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "already_paid"


# ---- taking a deposit at the counter, when the order is written up -------
def test_an_order_can_be_booked_with_a_deposit(client, make_product):
    p = make_product(price="400.00")["id"]
    payload = order_payload(p, "key-dep-0014", items=[{"product_id": p, "quantity": 1}])
    payload["payment_timing"] = "later"
    payload.pop("payment_method", None)
    payload["deposit"] = "100.00"
    payload["expected_payment_method"] = "cash"

    out = client.post("/api/v1/orders", json=payload).json()

    assert Decimal(out["amount_paid"]) == Decimal("100.00")
    assert Decimal(out["balance_due"]) == Decimal("300.00")
    assert out["paid_status"] == "unpaid"
    assert Decimal(_report(client, date.today())["revenue"]) == Decimal("100.00")


def test_a_deposit_for_the_whole_total_is_just_full_payment(client, make_product):
    p = make_product(price="400.00")["id"]
    payload = order_payload(p, "key-dep-0015", items=[{"product_id": p, "quantity": 1}])
    payload["payment_timing"] = "later"
    payload.pop("payment_method", None)
    payload["deposit"] = "400.00"

    out = client.post("/api/v1/orders", json=payload).json()

    assert out["paid_status"] == "paid"
    assert Decimal(out["balance_due"]) == Decimal("0.00")


def test_a_deposit_on_a_pay_now_order_is_refused(client, make_product):
    """Paying now already means the whole total; both at once is a contradiction."""
    p = make_product(price="400.00")["id"]
    payload = order_payload(p, "key-dep-0016", items=[{"product_id": p, "quantity": 1}])
    payload["payment_timing"] = "now"
    payload["payment_method"] = "cash"
    payload["deposit"] = "100.00"

    assert client.post("/api/v1/orders", json=payload).status_code == 400


# ---- undoing a mistake ----------------------------------------------------
def test_removing_a_payment_takes_the_order_back_to_unpaid(client, make_product):
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0017", items=[{"product_id": p, "quantity": 1}])
    paid = _pay(client, order["id"], "400.00", method="cash").json()
    assert paid["paid_status"] == "paid"
    payment_id = paid["payments"][0]["id"]

    out = client.delete(
        f"/api/v1/orders/{order['id']}/payments/{payment_id}"
    ).json()

    assert out["paid_status"] == "unpaid"
    assert Decimal(out["amount_paid"]) == Decimal("0.00")
    assert out["paid_at"] is None
    # And it comes off the day's takings — it was never the shop's money.
    assert Decimal(_report(client, date.today())["revenue"]) == Decimal("0.00")


def test_a_removed_payment_is_recoverable(client, make_product):
    """Nothing is destroyed — same rule as every other delete in the app."""
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0018", items=[{"product_id": p, "quantity": 1}])
    paid = _pay(client, order["id"], "250.00", method="cash").json()
    payment_id = paid["payments"][0]["id"]
    client.delete(f"/api/v1/orders/{order['id']}/payments/{payment_id}")

    mine = [t for t in client.get("/api/v1/trash").json() if t["kind"] == "order_payment"]
    assert len(mine) == 1
    assert "250" in mine[0]["label"]
    # Money in a snapshot is a string, never a float, or it comes back a cent off.
    assert mine[0]["payload"]["amount"] == "250.00"


def test_a_cancelled_order_cannot_take_a_payment(client, make_product):
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0019", items=[{"product_id": p, "quantity": 1}])
    client.post(f"/api/v1/orders/{order['id']}/cancel", json={"reverse_stock": False})

    r = _pay(client, order["id"], "100.00")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "order_cancelled"


def test_a_cancelled_order_stops_counting_as_revenue(client, make_product):
    """It was taken, then the order went away — the report must not keep it."""
    p = make_product(price="400.00")["id"]
    order = _order(client, p, "key-dep-0020", items=[{"product_id": p, "quantity": 1}])
    _pay(client, order["id"], "100.00", method="cash")
    assert Decimal(_report(client, date.today())["revenue"]) == Decimal("100.00")

    client.post(f"/api/v1/orders/{order['id']}/cancel", json={"reverse_stock": False})

    assert Decimal(_report(client, date.today())["revenue"]) == Decimal("0.00")
