"""Assistant write-action tests: creating orders, expenses, and deletions.

Split from test_assistant.py, which covers the read/propose/confirm mechanics
themselves. The scripted-model helpers are shared from there — the model is
never real in either file.
"""

from tests.test_assistant import (  # noqa: F401  (fake_model is a fixture)
    _make_order,
    _Response,
    _Text,
    _ToolUse,
    fake_model,
)


# ---------------------------------------------------------------------------
# creating orders
# ---------------------------------------------------------------------------
def test_create_order_proposal_prices_from_the_catalog_not_the_model(client, make_product, fake_model):
    """The total on the confirmation is computed from catalog prices, so a
    model that low-balls the price cannot get a cheap order approved."""
    p = make_product(name="Cheesecake", price="150.00")

    fake_model(_Response("tool_use", [
        _Text("That'll be about $5."),  # the model's own claim, ignored
        _ToolUse("create_order", {
            "client_name": "Rivka Cohen",
            "fulfillment_type": "pickup",
            "payment_timing": "later",
            "items": [{"product_id": p["id"], "quantity": 2}],
            "needed_for_date": "2026-09-02",
        }),
    ]))

    r = client.post("/api/v1/assistant/chat",
                    json={"messages": [{"role": "user", "text": "order 2 cheesecakes for Rivka"}]})
    assert r.status_code == 200, r.text
    summary = r.json()["proposal"]["summary"]
    assert "Rivka Cohen" in summary
    assert "2 x Cheesecake" in summary
    assert "$300.00" in summary   # 2 x 150, priced server-side
    assert "$5." not in summary


def test_create_order_runs_on_confirm(client, make_product):
    p = make_product(name="Babka", price="20.00")

    r = client.post("/api/v1/assistant/act", json={
        "action": "create_order",
        "args": {
            "client_name": "Weiss Catering",
            "fulfillment_type": "pickup",
            "payment_timing": "later",
            "items": [{"product_id": p["id"], "quantity": 3}],
        },
    })
    assert r.status_code == 200, r.text

    rows = client.get("/api/v1/orders").json()["items"]
    made = [o for o in rows if o["client_name"] == "Weiss Catering"]
    assert len(made) == 1
    assert made[0]["total"] == "60.00"


def test_a_delivery_without_an_address_is_refused(client, make_product):
    p = make_product()
    r = client.post("/api/v1/assistant/act", json={
        "action": "create_order",
        "args": {
            "client_name": "No Address", "fulfillment_type": "delivery",
            "payment_timing": "later", "items": [{"product_id": p["id"], "quantity": 1}],
        },
    })
    assert r.status_code == 400
    assert "address" in r.json()["error"]["message"].lower()


def test_an_order_with_no_items_is_refused(client):
    r = client.post("/api/v1/assistant/act", json={
        "action": "create_order",
        "args": {"client_name": "Empty", "fulfillment_type": "pickup",
                 "payment_timing": "later", "items": []},
    })
    assert r.status_code == 400


def test_paying_now_needs_a_method(client, make_product):
    p = make_product()
    r = client.post("/api/v1/assistant/act", json={
        "action": "create_order",
        "args": {"client_name": "Cash Buyer", "fulfillment_type": "pickup",
                 "payment_timing": "now", "items": [{"product_id": p["id"], "quantity": 1}]},
    })
    assert r.status_code == 400


def test_an_unknown_product_is_refused(client):
    r = client.post("/api/v1/assistant/act", json={
        "action": "create_order",
        "args": {"client_name": "Ghost", "fulfillment_type": "pickup",
                 "payment_timing": "later", "items": [{"product_id": 9999, "quantity": 1}]},
    })
    assert r.status_code == 404


def test_each_confirmed_order_is_distinct(client, make_product):
    """The idempotency key is minted server-side per confirmation, so ordering
    the same thing twice makes two orders rather than silently deduping."""
    p = make_product(price="10.00")
    args = {"client_name": "Repeat Customer", "fulfillment_type": "pickup",
            "payment_timing": "later", "items": [{"product_id": p["id"], "quantity": 1}]}

    client.post("/api/v1/assistant/act", json={"action": "create_order", "args": args})
    client.post("/api/v1/assistant/act", json={"action": "create_order", "args": args})

    rows = client.get("/api/v1/orders").json()["items"]
    assert len([o for o in rows if o["client_name"] == "Repeat Customer"]) == 2


# ---------------------------------------------------------------------------
# expenses
# ---------------------------------------------------------------------------
def test_expense_is_created_and_deleted_on_confirm(client):
    made = client.post("/api/v1/assistant/act", json={
        "action": "create_expense",
        "args": {"description": "Sysco - flour", "amount": 284.60,
                 "category": "Ingredients", "spent_on": "2026-08-27"},
    })
    assert made.status_code == 200, made.text
    assert "284.60" in made.json()["result"]

    listed = client.get("/api/v1/expenses?from=2026-08-27&to=2026-08-27").json()
    assert [e["description"] for e in listed] == ["Sysco - flour"]

    gone = client.post("/api/v1/assistant/act", json={
        "action": "delete_expense", "args": {"expense_id": listed[0]["id"]},
    })
    assert gone.status_code == 200
    assert "cannot be undone" in gone.json()["result"]
    assert client.get("/api/v1/expenses?from=2026-08-27&to=2026-08-27").json() == []


def test_a_negative_expense_is_refused(client):
    r = client.post("/api/v1/assistant/act", json={
        "action": "create_expense", "args": {"description": "Refund", "amount": -50},
    })
    assert r.status_code == 400


def test_expenses_are_hidden_from_someone_without_reports(make_user, fake_model):
    """Expenses live behind the reports section — a cashier shouldn't even be
    offered the tools."""
    _, _, cashier = make_user("No Reports Nate", "cashier")
    model = fake_model(_Response("end_turn", [_Text("hi")]))
    cashier.post("/api/v1/assistant/chat", json={"messages": [{"role": "user", "text": "hello"}]})

    assert "create_expense" not in model.tool_names
    assert "delete_expense" not in model.tool_names


# ---------------------------------------------------------------------------
# deleting an order — admin only, cancelled only
# ---------------------------------------------------------------------------
def test_deleting_a_live_order_is_refused(client, make_product):
    order = _make_order(client, make_product()["id"], key="key-del-live")

    r = client.post("/api/v1/assistant/act",
                    json={"action": "delete_order", "args": {"order_id": order["id"]}})
    assert r.status_code == 400
    assert "not cancelled" in r.json()["error"]["message"].lower()
    assert client.get(f"/api/v1/orders/{order['id']}").status_code == 200


def test_a_cancelled_order_can_be_deleted(client, make_product):
    order = _make_order(client, make_product()["id"], key="key-del-cancelled")
    client.post(f"/api/v1/orders/{order['id']}/cancel", json={"reverse_stock": True})

    r = client.post("/api/v1/assistant/act",
                    json={"action": "delete_order", "args": {"order_id": order["id"]}})
    assert r.status_code == 200
    assert client.get(f"/api/v1/orders/{order['id']}").status_code == 404


def test_a_manager_is_not_offered_order_deletion(make_user, fake_model):
    _, _, manager = make_user("Manager Mo", "manager")
    model = fake_model(_Response("end_turn", [_Text("hi")]))
    manager.post("/api/v1/assistant/chat", json={"messages": [{"role": "user", "text": "hello"}]})

    assert "cancel_order" in model.tool_names       # managers may cancel
    assert "delete_order" not in model.tool_names   # ...but not destroy


def test_a_manager_cannot_delete_an_order_by_posting_directly(make_user, client, make_product):
    """The admin-only tier is enforced on confirm, not just by hiding the tool."""
    order = _make_order(client, make_product()["id"], key="key-del-mgr")
    client.post(f"/api/v1/orders/{order['id']}/cancel", json={"reverse_stock": True})
    _, _, manager = make_user("Sneaky Sam", "manager")

    r = manager.post("/api/v1/assistant/act",
                     json={"action": "delete_order", "args": {"order_id": order["id"]}})
    assert r.status_code == 403
    assert client.get(f"/api/v1/orders/{order['id']}").status_code == 200


# ---------------------------------------------------------------------------
# tasks
# ---------------------------------------------------------------------------
def test_task_can_be_created_and_ticked_off(client):
    made = client.post("/api/v1/assistant/act", json={
        "action": "create_task", "args": {"title": "Restock flour", "assigned_to": 1},
    })
    assert made.status_code == 200, made.text

    task = client.get("/api/v1/tasks").json()[0]
    assert task["done"] is False

    done = client.post("/api/v1/assistant/act",
                       json={"action": "mark_task_done", "args": {"task_id": task["id"]}})
    assert done.status_code == 200
    assert client.get("/api/v1/tasks").json()[0]["done"] is True
