"""Assistant + customers: proposing several changes at once, and the tidy-up
actions that motivated it.

The real case: a party planner whose orders were entered as "Herman - Srugo",
"Herman - Frankl" and so on, landing as several unrelated customers. Sorting
that out is three merges and a handful of labels — which is unusable if each
one needs its own round trip.
"""

from tests.conftest import order_payload
from tests.test_assistant import (  # noqa: F401  (fake_model is a fixture)
    _Response,
    _Text,
    _ToolUse,
    fake_model,
)


def _order(client, product_id, key, name, phone=None):
    payload = order_payload(product_id, key, client_name=name, payment_timing="later")
    payload.pop("payment_method", None)
    payload["client_phone"] = phone
    r = client.post("/api/v1/orders", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _customers(client):
    return client.get("/api/v1/customers").json()


# ---------------------------------------------------------------------------
# several proposals in one turn
# ---------------------------------------------------------------------------
def test_one_turn_can_propose_several_changes(client, make_product, fake_model):
    p = make_product()["id"]
    _order(client, p, "key-ac-0001", "Herman - Srugo", "4383705825")
    _order(client, p, "key-ac-0002", "Herman Braun", None)
    _order(client, p, "key-ac-0003", "Herman Mermelstein", None)
    ids = {c["name"]: c["id"] for c in _customers(client)}

    fake_model(_Response("tool_use", [
        _Text("I'll fold both into Herman - Srugo."),
        _ToolUse("merge_customers",
                 {"keep_id": ids["Herman - Srugo"], "duplicate_id": ids["Herman Braun"]}, "tu_a"),
        _ToolUse("merge_customers",
                 {"keep_id": ids["Herman - Srugo"], "duplicate_id": ids["Herman Mermelstein"]}, "tu_b"),
    ]))

    out = client.post("/api/v1/assistant/chat",
                      json={"message": "merge the other Hermans into Herman - Srugo"}).json()

    assert len(out["proposals"]) == 2
    assert {p["action"] for p in out["proposals"]} == {"merge_customers"}
    # Each is described separately: approving a batch is not approving a blob.
    assert "Herman Braun" in out["proposals"][0]["summary"]
    assert "Herman Mermelstein" in out["proposals"][1]["summary"]
    assert all("cannot be undone" in p["summary"] for p in out["proposals"])

    # And still nothing has happened.
    assert len(_customers(client)) == 3


def test_a_batch_only_takes_effect_when_each_item_is_confirmed(client, make_product, fake_model):
    p = make_product()["id"]
    _order(client, p, "key-ac-0004", "Herman - Srugo", "4383705825")
    _order(client, p, "key-ac-0005", "Herman Braun", None)
    ids = {c["name"]: c["id"] for c in _customers(client)}

    fake_model(_Response("tool_use", [
        _ToolUse("merge_customers",
                 {"keep_id": ids["Herman - Srugo"], "duplicate_id": ids["Herman Braun"]}),
    ]))
    out = client.post("/api/v1/assistant/chat", json={"message": "merge them"}).json()

    proposal = out["proposals"][0]
    assert client.post("/api/v1/assistant/act",
                       json={"action": proposal["action"], "args": proposal["args"]}).status_code == 200

    names = [c["name"] for c in _customers(client)]
    assert names == ["Herman - Srugo"]


# ---------------------------------------------------------------------------
# the individual tidy-up actions
# ---------------------------------------------------------------------------
def test_renaming_a_customer_leaves_past_orders_alone(client, make_product):
    p = make_product()["id"]
    order = _order(client, p, "key-ac-0006", "Herman - Srugo", "4383705825")
    cid = _customers(client)[0]["id"]

    r = client.post("/api/v1/assistant/act",
                    json={"action": "rename_customer", "args": {"customer_id": cid, "name": "Herman"}})
    assert r.status_code == 200

    assert client.get(f"/api/v1/customers/{cid}").json()["name"] == "Herman"
    # The order still says what was typed on it at the time.
    assert client.get(f"/api/v1/orders/{order['id']}").json()["client_name"] == "Herman - Srugo"


def test_labelling_who_an_order_was_for(client, make_product):
    p = make_product()["id"]
    order = _order(client, p, "key-ac-0007", "Herman", "4383705825")

    r = client.post("/api/v1/assistant/act", json={
        "action": "set_order_for_whom",
        "args": {"order_id": order["id"], "for_whom": "Srugo"},
    })
    assert r.status_code == 200
    assert "Srugo" in r.json()["result"]
    assert client.get(f"/api/v1/orders/{order['id']}").json()["for_whom"] == "Srugo"


def test_merging_a_customer_into_itself_is_refused(client, make_product):
    p = make_product()["id"]
    _order(client, p, "key-ac-0008", "Solo", "5140001111")
    cid = _customers(client)[0]["id"]

    r = client.post("/api/v1/assistant/act",
                    json={"action": "merge_customers", "args": {"keep_id": cid, "duplicate_id": cid}})
    assert r.status_code == 400


def test_merging_an_unknown_customer_is_404(client, make_product):
    p = make_product()["id"]
    _order(client, p, "key-ac-0009", "Real Person", "5140002222")
    cid = _customers(client)[0]["id"]

    r = client.post("/api/v1/assistant/act",
                    json={"action": "merge_customers", "args": {"keep_id": cid, "duplicate_id": 9999}})
    assert r.status_code == 404


def test_a_cashier_cannot_merge_or_rename(make_user, client, make_product):
    """Both are manager+, enforced on confirm and not merely hidden."""
    p = make_product()["id"]
    _order(client, p, "key-ac-0010", "Someone", "5140003333")
    cid = _customers(client)[0]["id"]
    _, _, cashier = make_user("Cashier Cass", "cashier")

    assert cashier.post("/api/v1/assistant/act", json={
        "action": "merge_customers", "args": {"keep_id": cid, "duplicate_id": 2},
    }).status_code == 403
    assert cashier.post("/api/v1/assistant/act", json={
        "action": "rename_customer", "args": {"customer_id": cid, "name": "Nope"},
    }).status_code == 403


def test_a_cashier_is_not_offered_the_merge_tool(make_user, fake_model):
    _, _, cashier = make_user("Cashier Cal", "cashier")
    model = fake_model(_Response("end_turn", [_Text("hi")]))
    cashier.post("/api/v1/assistant/chat", json={"message": "hello"})

    assert "find_customers" in model.tool_names        # lookup is fine
    assert "set_order_for_whom" in model.tool_names    # labelling is fine
    assert "merge_customers" not in model.tool_names   # merging is not
    assert "rename_customer" not in model.tool_names


def test_the_assistant_can_read_a_customers_history(client, make_product, fake_model):
    p = make_product()["id"]
    _order(client, p, "key-ac-0011", "Herman", "4383705825")
    cid = _customers(client)[0]["id"]
    client.post("/api/v1/assistant/act", json={
        "action": "set_order_for_whom",
        "args": {"order_id": 1, "for_whom": "Srugo"},
    })

    model = fake_model(
        _Response("tool_use", [_ToolUse("customer_orders", {"customer_id": cid})]),
        _Response("end_turn", [_Text("One order, for Srugo.")]),
    )
    client.post("/api/v1/assistant/chat", json={"message": "what has Herman ordered?"})

    tool_result = model.calls[1]["messages"][-1]["content"][0]
    assert tool_result["is_error"] is False
    assert "Srugo" in tool_result["content"]


# ---------------------------------------------------------------------------
# setting a needed-for date
#
# The shop had three orders taken without a date and asked the assistant to
# fill them in. Nothing happened, because there was no tool that could set the
# date — every order write it had (paid, fulfilled, status, note, for_whom)
# touched something else.
# ---------------------------------------------------------------------------
def test_setting_a_date_on_an_order_that_has_none(client, make_product):
    p = make_product()["id"]
    order = _order(client, p, "key-ac-0012", "No Date Nancy", "5140009999")
    assert client.get(f"/api/v1/orders/{order['id']}").json()["needed_for_date"] is None

    r = client.post("/api/v1/assistant/act", json={
        "action": "set_order_date",
        "args": {"order_id": order["id"], "needed_for_date": "2026-09-05"},
    })
    assert r.status_code == 200, r.text

    saved = client.get(f"/api/v1/orders/{order['id']}").json()["needed_for_date"]
    # Stored verbatim: the date the shop said, not shifted by a timezone.
    assert saved.startswith("2026-09-05")


def test_the_date_confirmation_says_what_it_is_changing_from(client, make_product):
    p = make_product()["id"]
    order = _order(client, p, "key-ac-0013", "Date Mover", "5140008888")

    from app.services.assistant import describe
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        text = describe(db, "set_order_date",
                        {"order_id": order["id"], "needed_for_date": "2026-09-05T14:30"})
    finally:
        db.close()

    assert "Date Mover" in text
    assert "5 Sep 2026" in text
    assert "2:30 PM" in text
    assert "currently no date" in text


def test_an_unreadable_date_is_refused(client, make_product):
    p = make_product()["id"]
    order = _order(client, p, "key-ac-0014", "Bad Date", "5140007777")

    r = client.post("/api/v1/assistant/act", json={
        "action": "set_order_date",
        "args": {"order_id": order["id"], "needed_for_date": "next tuesday"},
    })
    assert r.status_code == 400
    assert client.get(f"/api/v1/orders/{order['id']}").json()["needed_for_date"] is None


def test_dating_several_orders_is_one_batch_of_proposals(client, make_product, fake_model):
    """The shop's actual request: three undated orders, filled in together
    rather than one question at a time."""
    p = make_product()["id"]
    a = _order(client, p, "key-ac-0015", "First", "5140001000")
    b = _order(client, p, "key-ac-0016", "Second", "5140002000")
    c = _order(client, p, "key-ac-0017", "Third", "5140003000")

    fake_model(_Response("tool_use", [
        _Text("I'll put all three on the 5th."),
        _ToolUse("set_order_date", {"order_id": a["id"], "needed_for_date": "2026-09-05"}, "t1"),
        _ToolUse("set_order_date", {"order_id": b["id"], "needed_for_date": "2026-09-05"}, "t2"),
        _ToolUse("set_order_date", {"order_id": c["id"], "needed_for_date": "2026-09-05"}, "t3"),
    ]))

    out = client.post("/api/v1/assistant/chat",
                      json={"message": "the three orders with no date are all for the 5th"}).json()

    assert len(out["proposals"]) == 3
    assert {p_["action"] for p_ in out["proposals"]} == {"set_order_date"}
    # Still nothing written until each is confirmed.
    for order in (a, b, c):
        assert client.get(f"/api/v1/orders/{order['id']}").json()["needed_for_date"] is None


def test_a_cashier_is_offered_the_date_tool(make_user, fake_model):
    """Taking a date down is ordinary counter work, not a manager action."""
    _, _, cashier = make_user("Cashier Chaya", "cashier")
    model = fake_model(_Response("end_turn", [_Text("hi")]))
    cashier.post("/api/v1/assistant/chat", json={"message": "hello"})

    assert "set_order_date" in model.tool_names
