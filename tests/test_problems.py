"""The problem checker (GET /problems, and the assistant's find_problems) and
the assistant's newer actions: part payments, product changes, stock."""

from datetime import timedelta
from decimal import Decimal

from app.database import SessionLocal
from app.models import TimeEntry
from app.models.base import utc_today, utcnow
from app.services import assistant_tools
from tests.conftest import order_payload

URL = "/api/v1/problems"


def _order(client, product_id, key, **over):
    payload = order_payload(product_id, key, **over)
    if payload.get("payment_timing") == "later":
        payload.pop("payment_method", None)
    r = client.post("/api/v1/orders", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _kinds(client):
    r = client.get(URL)
    assert r.status_code == 200, r.text
    return {p["kind"]: p for p in r.json()}


def test_a_quiet_shop_has_no_problems(client):
    assert client.get(URL).json() == []


def test_an_order_past_its_date_and_not_picked_up(client, make_product):
    p = make_product()
    yesterday = (utc_today() - timedelta(days=1)).isoformat()
    old = _order(client, p["id"], "k-problem-overdue", needed_for_date=yesterday)
    # One that was picked up isn't a problem.
    done = _order(client, p["id"], "k-problem-done", needed_for_date=yesterday)
    client.post(f"/api/v1/orders/{done['id']}/fulfill")

    problem = _kinds(client)["overdue_orders"]
    assert problem["severity"] == "high"
    assert problem["order_ids"] == [old["id"]]
    assert "Jane Doe" in problem["detail"]


def test_money_owed_on_an_order_already_handed_over(client, make_product):
    p = make_product(price="20.00")
    o = _order(client, p["id"], "k-problem-unpaid", payment_timing="later")
    client.post(f"/api/v1/orders/{o['id']}/fulfill")

    problem = _kinds(client)["fulfilled_unpaid"]
    assert problem["title"].startswith("$40.00 still owed")
    assert problem["order_ids"] == [o["id"]]

    client.post(f"/api/v1/orders/{o['id']}/mark-paid", json={"payment_method": "cash"})
    assert "fulfilled_unpaid" not in _kinds(client)


def test_due_today_and_not_ready(client, make_product):
    p = make_product()
    o = _order(client, p["id"], "k-problem-today", needed_for_date=utc_today().isoformat())
    assert _kinds(client)["due_today_not_ready"]["order_ids"] == [o["id"]]
    client.put(f"/api/v1/orders/{o['id']}", json={"status": "ready"})
    assert "due_today_not_ready" not in _kinds(client)


def test_a_shift_never_clocked_out(client, make_user):
    uid, _, _ = make_user("rivky", "cashier")
    with SessionLocal() as db:
        db.add(TimeEntry(user_id=uid, clock_in=utcnow() - timedelta(hours=20)))
        db.commit()
    problem = _kinds(client)["open_shifts"]
    assert "rivky" in problem["detail"]


def test_a_cashier_only_sees_their_own_sections(client, make_user, make_product):
    """No bookkeeping or website checks, and only their own shifts."""
    p = make_product()
    yesterday = (utc_today() - timedelta(days=1)).isoformat()
    _order(client, p["id"], "k-problem-cashier", needed_for_date=yesterday)
    client.put(f"/api/v1/products/{p['id']}", json={"show_on_menu": True})
    other, _, _ = make_user("someone", "cashier")
    with SessionLocal() as db:
        db.add(TimeEntry(user_id=other, clock_in=utcnow() - timedelta(hours=20)))
        db.commit()

    assert {"overdue_orders", "website_without_photos", "open_shifts"} <= set(_kinds(client))
    _, _, cashier = make_user("cash", "cashier")
    seen = {p["kind"] for p in cashier.get(URL).json()}
    assert "overdue_orders" in seen
    assert "website_without_photos" not in seen
    assert "open_shifts" not in seen


def test_problems_need_a_session(anon_client):
    assert anon_client.get(URL).status_code == 401


def test_the_assistant_reads_the_same_list(client, make_product, db):
    from app.models import User

    p = make_product()
    yesterday = (utc_today() - timedelta(days=1)).isoformat()
    o = _order(client, p["id"], "k-problem-ai", needed_for_date=yesterday)
    admin = db.query(User).filter(User.name == "admin").one()
    text = assistant_tools.REGISTRY["find_problems"].run(db, admin, {})
    assert "[high]" in text and f"#{o['id']}" in text

    client.post(f"/api/v1/orders/{o['id']}/fulfill")
    with SessionLocal() as fresh:
        admin = fresh.get(User, admin.id)
        after = assistant_tools.REGISTRY["find_problems"].run(fresh, admin, {})
    assert "past their date" not in after


# ---------------------------------------------------------------------------
# the newer actions, through the same confirm-on-screen route
# ---------------------------------------------------------------------------
def _act(client, action, **args):
    return client.post("/api/v1/assistant/act", json={"action": action, "args": args})


def test_record_a_deposit(client, make_product):
    p = make_product(price="50.00")
    o = _order(client, p["id"], "k-act-deposit", payment_timing="later")
    r = _act(client, "record_payment", order_id=o["id"], amount="30", payment_method="cash")
    assert r.status_code == 200, r.text
    assert "$70.00 will still be owing" in r.json()["result"]
    after = client.get(f"/api/v1/orders/{o['id']}").json()
    assert Decimal(after["balance_due"]) == Decimal("70.00")
    assert after["paid_status"] == "unpaid"


def test_a_payment_above_the_balance_is_refused(client, make_product):
    p = make_product(price="10.00")
    o = _order(client, p["id"], "k-act-over", payment_timing="later")
    r = _act(client, "record_payment", order_id=o["id"], amount="25")
    assert r.status_code == 400
    assert client.get(f"/api/v1/orders/{o['id']}").json()["payments"] == []


def test_change_a_product(client, make_product):
    p = make_product(name="Babka", price="10.00")
    r = _act(client, "update_product", product_id=p["id"], price="12.50", show_on_menu=False)
    assert r.status_code == 200, r.text
    assert "price $10.00 → $12.50" in r.json()["result"]
    products = {x["id"]: x for x in client.get("/api/v1/products").json()}
    assert Decimal(products[p["id"]]["price"]) == Decimal("12.50")
    assert products[p["id"]]["show_on_menu"] is False


def test_a_product_change_with_nothing_to_change_is_refused(client, make_product):
    p = make_product()
    assert _act(client, "update_product", product_id=p["id"]).status_code == 400


def test_a_cashier_cannot_change_products_through_the_assistant(make_user, make_product):
    p = make_product()
    _, _, cashier = make_user("cash", "cashier")
    assert _act(cashier, "update_product", product_id=p["id"], price="1").status_code == 403


def test_adjust_ingredient_stock(client, make_ingredient):
    ing = make_ingredient(name="Flour", unit="kg")
    r = _act(client, "adjust_stock", item_type="ingredient", item_id=ing["id"],
             change="25", reason="Delivery")
    assert r.status_code == 200, r.text
    assert r.json()["result"] == "Add 25 kg of Flour in stock — Delivery."
    levels = client.get("/api/v1/stock").json()
    flour = next(x for x in levels if x["item_type"] == "ingredient" and x["item_id"] == ing["id"])
    assert Decimal(flour["quantity"]) == Decimal("25")


def test_a_zero_stock_change_is_refused(client, make_ingredient):
    ing = make_ingredient()
    r = _act(client, "adjust_stock", item_type="ingredient", item_id=ing["id"],
             change="0", reason="nothing")
    assert r.status_code == 400


def test_a_long_list_says_how_many_more(client, make_product):
    for n in range(7):
        make_product(name=f"Cake {n}")
    problem = _kinds(client)["website_without_photos"]
    assert problem["count"] == 7
    assert problem["detail"].endswith("and 2 more.")
