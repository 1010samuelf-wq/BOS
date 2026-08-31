"""Assistant tests.

The model is always faked. These tests must never make a network call or spend
money, so every one of them scripts the responses the model would have given
and asserts on what the *server* does with them — which is the part that
matters, because the server is what enforces the read/propose/confirm split.
"""

import pytest

from app.services import assistant as assistant_service
from tests.conftest import order_payload


# ---------------------------------------------------------------------------
# a scripted stand-in for anthropic.Anthropic
# ---------------------------------------------------------------------------
class _Text:
    type = "text"

    def __init__(self, text):
        self.text = text


class _ToolUse:
    type = "tool_use"

    def __init__(self, name, input_, id_="tu_1"):
        self.name = name
        self.input = input_
        self.id = id_


class _Response:
    def __init__(self, stop_reason, content):
        self.stop_reason = stop_reason
        self.content = content


class FakeModel:
    """Replays a scripted list of responses and records what it was sent."""

    def __init__(self, *responses):
        self._responses = list(responses)
        self.calls = []
        self.beta = self  # so `client.beta.messages.create` resolves
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)

    @property
    def tool_names(self):
        return {t["name"] for t in self.calls[0]["tools"]}


@pytest.fixture
def fake_model(monkeypatch):
    """Install a scripted model for the HTTP endpoints."""

    holder = {}

    def install(*responses):
        model = FakeModel(*responses)
        holder["model"] = model
        monkeypatch.setattr(assistant_service, "_client", lambda: model)
        monkeypatch.setattr(assistant_service, "is_enabled", lambda: True)
        return model

    return install


def _make_order(client, product_id, key="key-assistant-1", **over):
    payload = order_payload(product_id, key, **over)
    if payload.get("payment_timing") == "later":
        # The API rejects a method on a pay-later order; the default payload
        # carries one, so drop it rather than fighting the validator.
        payload.pop("payment_method", None)
    r = client.post("/api/v1/orders", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# reading
# ---------------------------------------------------------------------------
def test_read_tool_runs_and_its_output_reaches_the_model(client, make_product, fake_model):
    order = _make_order(client, make_product()["id"], client_name="Rivka Cohen")

    model = fake_model(
        _Response("tool_use", [_ToolUse("list_orders", {})]),
        _Response("end_turn", [_Text("You have one order, for Rivka Cohen.")]),
    )

    r = client.post("/api/v1/assistant/chat",
                    json={"message": "what orders are open?"})
    assert r.status_code == 200, r.text
    assert r.json()["reply"] == "You have one order, for Rivka Cohen."
    assert r.json()["proposals"] == []

    # The second call carries the tool result — proving the tool really ran
    # against the database rather than the model inventing an answer.
    tool_result = model.calls[1]["messages"][-1]["content"][0]
    assert tool_result["is_error"] is False
    assert f"Order #{order['id']}" in tool_result["content"]
    assert "Rivka Cohen" in tool_result["content"]


def test_a_failing_tool_is_reported_not_crashed(client, fake_model):
    """A bad tool argument comes back as an error result the model can react
    to, rather than 500-ing the whole conversation."""
    model = fake_model(
        _Response("tool_use", [_ToolUse("get_order", {"order_id": 9999})]),
        _Response("end_turn", [_Text("I couldn't find that order.")]),
    )

    r = client.post("/api/v1/assistant/chat",
                    json={"message": "show order 9999"})
    assert r.status_code == 200
    tool_result = model.calls[1]["messages"][-1]["content"][0]
    assert tool_result["is_error"] is True


def test_refusal_is_handled_before_reading_content(client, fake_model):
    """On a refusal the content list is empty — reading it blindly would throw."""
    fake_model(_Response("refusal", []))

    r = client.post("/api/v1/assistant/chat",
                    json={"message": "..."})
    assert r.status_code == 200
    assert "can't help" in r.json()["reply"]


def test_runaway_tool_loop_is_bounded(client, make_product, fake_model):
    make_product()
    # More tool calls than MAX_STEPS: the loop must give up, not spin forever.
    fake_model(*[
        _Response("tool_use", [_ToolUse("list_orders", {})])
        for _ in range(assistant_service.MAX_STEPS)
    ])

    r = client.post("/api/v1/assistant/chat",
                    json={"message": "loop"})
    assert r.status_code == 200
    assert r.json()["proposals"] == []
    assert "different way" in r.json()["reply"]


# ---------------------------------------------------------------------------
# proposing — the model must never write
# ---------------------------------------------------------------------------
def test_write_tool_only_proposes_and_changes_nothing(client, make_product, fake_model):
    order = _make_order(client, make_product()["id"], key="key-propose", payment_timing="later")
    assert order["paid_status"] == "unpaid"

    fake_model(_Response("tool_use", [
        _ToolUse("mark_order_paid", {"order_id": order["id"], "payment_method": "cash"})
    ]))

    r = client.post("/api/v1/assistant/chat",
                    json={"message": f"order {order['id']} paid cash"})
    assert r.status_code == 200
    proposal = r.json()["proposals"][0]
    assert proposal["action"] == "mark_order_paid"
    assert proposal["args"]["order_id"] == order["id"]

    # Nothing happened yet — this is the whole point.
    assert client.get(f"/api/v1/orders/{order['id']}").json()["paid_status"] == "unpaid"


def test_proposal_summary_is_built_from_the_database_not_the_model(client, make_product, fake_model):
    """The sentence the person approves is generated server-side, so a model
    that described one thing while calling another cannot mislead them."""
    order = _make_order(client, make_product()["id"], key="key-summary",
                        client_name="Weiss Catering", payment_timing="later")

    fake_model(_Response("tool_use", [
        # The model's own text claims a different order entirely.
        _Text("Marking order #999 for Somebody Else as paid."),
        _ToolUse("mark_order_paid", {"order_id": order["id"]}),
    ]))

    r = client.post("/api/v1/assistant/chat",
                    json={"message": "mark it paid"})
    summary = r.json()["proposals"][0]["summary"]
    assert f"#{order['id']}" in summary
    assert "Weiss Catering" in summary
    assert "999" not in summary


def test_proposal_for_a_missing_order_is_rejected(client, fake_model):
    fake_model(_Response("tool_use", [_ToolUse("mark_order_paid", {"order_id": 4242})]))

    r = client.post("/api/v1/assistant/chat",
                    json={"message": "mark 4242 paid"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# confirming
# ---------------------------------------------------------------------------
def test_confirmed_action_actually_runs(client, make_product):
    order = _make_order(client, make_product()["id"], key="key-confirm", payment_timing="later")

    r = client.post("/api/v1/assistant/act",
                    json={"action": "mark_order_paid",
                          "args": {"order_id": order["id"], "payment_method": "cash"}})
    assert r.status_code == 200, r.text
    assert f"#{order['id']}" in r.json()["result"]
    assert client.get(f"/api/v1/orders/{order['id']}").json()["paid_status"] == "paid"


def test_confirmed_note_and_status_changes_run(client, make_product):
    order = _make_order(client, make_product()["id"], key="key-confirm-2")

    assert client.post("/api/v1/assistant/act", json={
        "action": "add_order_note", "args": {"order_id": order["id"], "text": "Call before 9"},
    }).status_code == 200
    assert client.post("/api/v1/assistant/act", json={
        "action": "set_order_status", "args": {"order_id": order["id"], "status": "ready"},
    }).status_code == 200

    fetched = client.get(f"/api/v1/orders/{order['id']}").json()
    assert fetched["status"] == "ready"
    assert [n["text"] for n in fetched["notes"]] == ["Call before 9"]


def test_act_rejects_an_unknown_action(client):
    r = client.post("/api/v1/assistant/act", json={"action": "drop_database", "args": {}})
    assert r.status_code == 400


def test_act_rejects_a_read_tool(client):
    """Read tools are not actions — routing one through /act must not work."""
    r = client.post("/api/v1/assistant/act", json={"action": "sales_report", "args": {}})
    assert r.status_code == 400


def test_act_rechecks_permissions_against_the_caller(make_user, client, make_product):
    """The proposal arrives from the browser and is not trusted: a cashier
    posting a manager-only action directly must still be refused."""
    _, _, cashier = make_user("Cashier Cass", "cashier")
    admin_id = 1

    r = cashier.post("/api/v1/assistant/act", json={
        "action": "create_task", "args": {"title": "Sneak", "assigned_to": admin_id},
    })
    assert r.status_code == 403


def test_act_requires_authentication(anon_client):
    assert anon_client.post("/api/v1/assistant/act", json={
        "action": "mark_order_paid", "args": {"order_id": 1},
    }).status_code == 401


# ---------------------------------------------------------------------------
# permission scoping of the tool surface
# ---------------------------------------------------------------------------
def test_cashier_is_not_offered_tools_they_cannot_use(make_user, fake_model):
    _, _, cashier = make_user("Cash Only", "cashier")
    model = fake_model(_Response("end_turn", [_Text("hi")]))

    cashier.post("/api/v1/assistant/chat",
                 json={"message": "hello"})

    offered = model.tool_names
    assert "list_orders" in offered          # cashiers do take orders
    assert "sales_report" not in offered     # ...but have no reports section
    assert "create_task" not in offered      # ...and cannot assign work


def test_admin_is_offered_the_full_surface(client, fake_model):
    model = fake_model(_Response("end_turn", [_Text("hi")]))
    client.post("/api/v1/assistant/chat",
                json={"message": "hello"})

    assert {"sales_report", "create_task", "deliveries", "staff_hours"} <= model.tool_names


# ---------------------------------------------------------------------------
# wiring
# ---------------------------------------------------------------------------
def test_an_empty_message_is_rejected(client, fake_model):
    fake_model(_Response("end_turn", [_Text("hi")]))
    assert client.post("/api/v1/assistant/chat", json={"message": ""}).status_code == 400


def test_assistant_is_disabled_without_a_key(client):
    """No key configured — the default in tests — must 503 rather than crash."""
    r = client.post("/api/v1/assistant/chat",
                    json={"message": "hi"})
    assert r.status_code == 503
    assert client.get("/api/v1/assistant/status").json()["enabled"] is False


def test_the_model_is_never_sent_a_write_tool_result(client, make_product, fake_model):
    """Belt and braces: confirm the loop returns at the write tool instead of
    executing it and feeding a result back."""
    order = _make_order(client, make_product()["id"], key="key-noexec")
    model = fake_model(_Response("tool_use", [_ToolUse("fulfill_order", {"order_id": order["id"]})]))

    client.post("/api/v1/assistant/chat",
                json={"message": "fulfil it"})

    assert len(model.calls) == 1  # never went round again
    assert client.get(f"/api/v1/orders/{order['id']}").json()["fulfillment_status"] == "pending"


def test_a_bad_api_key_gives_a_usable_error_not_a_500(client, monkeypatch):
    """An upstream auth failure must tell whoever is on shift what happened,
    not surface as a generic 'unexpected error'."""
    import anthropic
    import httpx2

    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    failure = anthropic.AuthenticationError(
        "invalid x-api-key", response=httpx2.Response(401, request=request), body=None
    )

    class Failing:
        def __init__(self):
            self.beta = self
            self.messages = self

        def create(self, **kwargs):
            raise failure

    monkeypatch.setattr(assistant_service, "_client", Failing)

    r = client.post("/api/v1/assistant/chat",
                    json={"message": "hi"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "assistant_unavailable"


def test_an_unreachable_model_provider_is_a_502(client, monkeypatch):
    class Failing:
        def __init__(self):
            self.beta = self
            self.messages = self

        def create(self, **kwargs):
            raise RuntimeError("boom")

    monkeypatch.setattr(assistant_service, "_client", Failing)

    r = client.post("/api/v1/assistant/chat",
                    json={"message": "hi"})
    assert r.status_code == 502
