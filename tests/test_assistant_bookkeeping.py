"""The assistant on the books: adding a company, and charges/payments against it.

The shop asked for this directly — "add a company and within the company to add
a charge or a payment with the date and the amount with a note". Everything
here is still propose-then-confirm; the ledger is money, so the model gets to
ask and nothing more.
"""

from decimal import Decimal

from tests.test_assistant import (  # noqa: F401  (fake_model is a fixture)
    _Response,
    _Text,
    _ToolUse,
    fake_model,
)


def _company(client, name="Flour Co", type_="payable"):
    r = client.post("/api/v1/bookkeeping/companies", json={"name": name, "type": type_})
    assert r.status_code == 201, r.text
    return r.json()


def _detail(client, cid):
    return client.get(f"/api/v1/bookkeeping/companies/{cid}").json()


# ---------------------------------------------------------------------------
# adding a company
# ---------------------------------------------------------------------------
def test_a_company_is_only_added_on_confirm(client, fake_model):
    fake_model(_Response("tool_use", [
        _ToolUse("create_company", {"name": "Sysco", "type": "payable"}),
    ]))
    out = client.post("/api/v1/assistant/chat",
                      json={"message": "add Sysco as a supplier"}).json()

    assert len(out["proposals"]) == 1
    assert "Sysco" in out["proposals"][0]["summary"]
    assert "owes" in out["proposals"][0]["summary"]
    # Nothing yet.
    assert client.get("/api/v1/bookkeeping/companies").json() == []

    client.post("/api/v1/assistant/act", json={
        "action": "create_company", "args": {"name": "Sysco", "type": "payable"},
    })
    rows = client.get("/api/v1/bookkeeping/companies").json()
    assert [(c["name"], c["type"]) for c in rows] == [("Sysco", "payable")]


def test_a_company_needs_a_real_direction(client):
    r = client.post("/api/v1/assistant/act", json={
        "action": "create_company", "args": {"name": "Vague Inc", "type": "sideways"},
    })
    assert r.status_code == 400
    assert client.get("/api/v1/bookkeeping/companies").json() == []


def test_a_nameless_company_is_refused(client):
    r = client.post("/api/v1/assistant/act", json={
        "action": "create_company", "args": {"name": "   ", "type": "payable"},
    })
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# charges and payments
# ---------------------------------------------------------------------------
def test_a_charge_and_a_payment_move_the_balance(client):
    cid = _company(client)["id"]

    client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
        "company_id": cid, "type": "charge", "amount": 150.00,
        "entry_date": "2026-08-01", "note": "flour order",
    }})
    client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
        "company_id": cid, "type": "payment", "amount": 100.00, "entry_date": "2026-08-10",
    }})

    detail = _detail(client, cid)
    assert Decimal(detail["balance"]) == Decimal("50.00")
    assert [e["type"] for e in detail["entries"]] == ["charge", "payment"]
    assert detail["entries"][0]["note"] == "flour order"


def test_the_note_and_date_are_kept(client):
    cid = _company(client)["id"]
    client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
        "company_id": cid, "type": "charge", "amount": 42.50,
        "entry_date": "2026-07-04", "note": "  delivery van   repair  ",
    }})
    entry = _detail(client, cid)["entries"][0]
    assert entry["entry_date"] == "2026-07-04"
    assert Decimal(entry["amount"]) == Decimal("42.50")
    assert entry["note"] == "delivery van repair"


def test_an_entry_with_no_date_lands_on_today(client):
    from app.models.base import utc_today

    cid = _company(client)["id"]
    client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
        "company_id": cid, "type": "charge", "amount": 10,
    }})
    assert _detail(client, cid)["entries"][0]["entry_date"] == utc_today().isoformat()


def test_the_confirmation_spells_out_which_way_the_balance_moves(client):
    """A charge and a payment look alike in a confirmation box, so the sentence
    has to say what happens to the balance."""
    from app.database import SessionLocal
    from app.services.assistant import describe

    cid = _company(client, "Bakers Supply")["id"]
    client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
        "company_id": cid, "type": "charge", "amount": 200, "entry_date": "2026-08-01",
    }})

    db = SessionLocal()
    try:
        text = describe(db, "add_ledger_entry", {
            "company_id": cid, "type": "payment", "amount": 75,
            "entry_date": "2026-08-09", "note": "cheque 114",
        })
    finally:
        db.close()

    assert "Bakers Supply" in text
    assert "$75.00" in text
    assert "9 Aug 2026" in text
    assert "cheque 114" in text
    assert "comes off" in text
    assert "$200.00 becomes $125.00" in text


def test_a_negative_or_zero_amount_is_refused(client):
    cid = _company(client)["id"]
    for bad in (-50, 0):
        r = client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
            "company_id": cid, "type": "charge", "amount": bad,
        }})
        assert r.status_code == 400, bad
    assert _detail(client, cid)["entries"] == []


def test_an_amount_keeps_its_cents(client):
    """Decimal(str(x)), not Decimal(float) — 284.60 must not become 284.60...02."""
    cid = _company(client)["id"]
    client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
        "company_id": cid, "type": "charge", "amount": 284.60,
    }})
    assert Decimal(_detail(client, cid)["entries"][0]["amount"]) == Decimal("284.60")


def test_an_unreadable_date_is_refused(client):
    cid = _company(client)["id"]
    r = client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
        "company_id": cid, "type": "charge", "amount": 10, "entry_date": "last friday",
    }})
    assert r.status_code == 400
    assert _detail(client, cid)["entries"] == []


def test_an_entry_against_an_unknown_company_is_404(client):
    r = client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
        "company_id": 9999, "type": "charge", "amount": 10,
    }})
    assert r.status_code == 404


def test_several_entries_can_be_proposed_at_once(client, fake_model):
    """A supplier statement is a handful of lines, not one."""
    cid = _company(client)["id"]
    fake_model(_Response("tool_use", [
        _Text("Three lines off that statement."),
        _ToolUse("add_ledger_entry", {"company_id": cid, "type": "charge", "amount": 100,
                                      "entry_date": "2026-08-01", "note": "flour"}, "b1"),
        _ToolUse("add_ledger_entry", {"company_id": cid, "type": "charge", "amount": 60,
                                      "entry_date": "2026-08-02", "note": "sugar"}, "b2"),
        _ToolUse("add_ledger_entry", {"company_id": cid, "type": "payment", "amount": 40,
                                      "entry_date": "2026-08-08"}, "b3"),
    ]))

    out = client.post("/api/v1/assistant/chat",
                      json={"message": "put the Flour Co statement on the books"}).json()

    assert len(out["proposals"]) == 3
    assert "flour" in out["proposals"][0]["summary"]
    assert _detail(client, cid)["entries"] == []


# ---------------------------------------------------------------------------
# reading
# ---------------------------------------------------------------------------
def test_the_assistant_can_read_a_companys_ledger(client, fake_model):
    cid = _company(client, "Cheese Guy")["id"]
    client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
        "company_id": cid, "type": "charge", "amount": 90, "entry_date": "2026-08-03",
        "note": "mozzarella",
    }})

    model = fake_model(
        _Response("tool_use", [_ToolUse("company_ledger", {"company_id": cid})]),
        _Response("end_turn", [_Text("You owe Cheese Guy $90.")]),
    )
    client.post("/api/v1/assistant/chat", json={"message": "what do we owe Cheese Guy?"})

    result = model.calls[1]["messages"][-1]["content"][0]
    assert result["is_error"] is False
    assert "mozzarella" in result["content"]
    assert "90.00" in result["content"]


def test_listing_companies_says_which_way_the_money_runs(client, fake_model):
    supplier = _company(client, "We Owe Them", "payable")["id"]
    debtor = _company(client, "They Owe Us", "receivable")["id"]
    for cid in (supplier, debtor):
        client.post("/api/v1/assistant/act", json={"action": "add_ledger_entry", "args": {
            "company_id": cid, "type": "charge", "amount": 25,
        }})

    model = fake_model(
        _Response("tool_use", [_ToolUse("list_companies", {})]),
        _Response("end_turn", [_Text("Two on the books.")]),
    )
    client.post("/api/v1/assistant/chat", json={"message": "whos on the books?"})

    text = model.calls[1]["messages"][-1]["content"][0]["content"]
    assert "We Owe Them (payable); $25.00 — we owe them" in text
    assert "They Owe Us (receivable); $25.00 — they owe us" in text


def test_bookkeeping_tools_are_hidden_from_someone_without_the_section(make_user, fake_model):
    _, _, cashier = make_user("Cashier Cass", "cashier")
    model = fake_model(_Response("end_turn", [_Text("hi")]))
    cashier.post("/api/v1/assistant/chat", json={"message": "hello"})

    for name in ("list_companies", "company_ledger", "create_company", "add_ledger_entry"):
        assert name not in model.tool_names, name


def test_a_cashier_cannot_post_to_the_ledger_directly(make_user, client):
    """Enforced on confirm, not merely hidden from the model."""
    cid = _company(client)["id"]
    _, _, cashier = make_user("Sneaky Sam", "cashier")

    assert cashier.post("/api/v1/assistant/act", json={
        "action": "add_ledger_entry",
        "args": {"company_id": cid, "type": "charge", "amount": 500},
    }).status_code == 403
    assert cashier.post("/api/v1/assistant/act", json={
        "action": "create_company", "args": {"name": "Ghost Co", "type": "payable"},
    }).status_code == 403
