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
