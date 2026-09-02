"""Deleted things go to the trash instead of vanishing.

The shop's rule: "anything deleted should go to a special folder". So every
delete path in the app has to leave a record behind, and the ones that can be
put back safely have to actually go back.
"""

from decimal import Decimal

from tests.conftest import order_payload


def _trash(client, **params):
    return client.get("/api/v1/trash", params=params).json()


def _company_with_entry(client, amount="150.00", note="flour"):
    cid = client.post(
        "/api/v1/bookkeeping/companies", json={"name": "Flour Co", "type": "payable"}
    ).json()["id"]
    eid = client.post(f"/api/v1/bookkeeping/companies/{cid}/entries", json={
        "entry_date": "2026-08-01", "type": "charge", "amount": amount, "note": note,
    }).json()["entries"][0]["id"]
    return cid, eid


# ---------------------------------------------------------------------------
# ledger entries — the kind that round-trips
# ---------------------------------------------------------------------------
def test_a_deleted_ledger_line_lands_in_the_trash(client):
    cid, eid = _company_with_entry(client)
    client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}")

    items = _trash(client)
    assert len(items) == 1
    assert items[0]["kind"] == "ledger_entry"
    # The label has to stand on its own — the row it describes is gone.
    assert "Flour Co" in items[0]["label"]
    assert "150.00" in items[0]["label"]
    assert "flour" in items[0]["label"]
    assert items[0]["restorable"] is True


def test_putting_a_ledger_line_back_restores_the_balance(client):
    cid, eid = _company_with_entry(client)
    client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}")
    assert Decimal(client.get(f"/api/v1/bookkeeping/companies/{cid}").json()["balance"]) == Decimal("0")

    item = _trash(client)[0]
    assert client.post(f"/api/v1/trash/{item['id']}/restore").status_code == 200

    detail = client.get(f"/api/v1/bookkeeping/companies/{cid}").json()
    assert Decimal(detail["balance"]) == Decimal("150.00")
    entry = detail["entries"][0]
    assert entry["note"] == "flour"
    assert entry["entry_date"] == "2026-08-01"
    assert entry["type"] == "charge"


def test_money_survives_the_round_trip_exactly(client):
    """Stored as a string, not a float — 420.55 must come back as 420.55."""
    cid, eid = _company_with_entry(client, amount="420.55")
    client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}")
    client.post(f"/api/v1/trash/{_trash(client)[0]['id']}/restore")

    detail = client.get(f"/api/v1/bookkeeping/companies/{cid}").json()
    assert Decimal(detail["entries"][0]["amount"]) == Decimal("420.55")


def test_a_restored_item_drops_off_the_default_list(client):
    cid, eid = _company_with_entry(client)
    client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}")
    client.post(f"/api/v1/trash/{_trash(client)[0]['id']}/restore")

    assert _trash(client) == []
    # ...but the history that it happened is still there.
    history = _trash(client, include_restored=True)
    assert len(history) == 1
    assert history[0]["restored_at"] is not None


def test_the_same_thing_cannot_be_restored_twice(client):
    cid, eid = _company_with_entry(client)
    client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}")
    item_id = _trash(client)[0]["id"]

    assert client.post(f"/api/v1/trash/{item_id}/restore").status_code == 200
    assert client.post(f"/api/v1/trash/{item_id}/restore").status_code == 400
    # And it didn't get added a second time.
    assert len(client.get(f"/api/v1/bookkeeping/companies/{cid}").json()["entries"]) == 1


def test_a_line_cannot_be_restored_onto_a_company_that_is_gone(client):
    from app.database import SessionLocal
    from app.models import Company

    cid, eid = _company_with_entry(client)
    client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}")

    db = SessionLocal()
    try:
        db.delete(db.get(Company, cid))
        db.commit()
    finally:
        db.close()

    r = client.post(f"/api/v1/trash/{_trash(client)[0]['id']}/restore")
    assert r.status_code == 400
    assert "no longer on the books" in r.json()["error"]["message"]


# ---------------------------------------------------------------------------
# expenses
# ---------------------------------------------------------------------------
def test_a_deleted_expense_can_be_put_back(client):
    made = client.post("/api/v1/expenses", json={
        "description": "Sysco - flour", "amount": "284.60",
        "category": "Ingredients", "spent_on": "2026-08-27",
    }).json()
    client.delete(f"/api/v1/expenses/{made['id']}")
    assert client.get("/api/v1/expenses?from=2026-08-27&to=2026-08-27").json() == []

    item = _trash(client)[0]
    assert item["kind"] == "expense"
    assert "284.60" in item["label"]
    client.post(f"/api/v1/trash/{item['id']}/restore")

    back = client.get("/api/v1/expenses?from=2026-08-27&to=2026-08-27").json()
    assert len(back) == 1
    assert back[0]["description"] == "Sysco - flour"
    assert Decimal(back[0]["amount"]) == Decimal("284.60")
    assert back[0]["category"] == "Ingredients"


def test_an_expense_deleted_through_the_assistant_is_kept_too(client):
    client.post("/api/v1/assistant/act", json={
        "action": "create_expense",
        "args": {"description": "Fuel", "amount": 60, "spent_on": "2026-08-27"},
    })
    eid = client.get("/api/v1/expenses?from=2026-08-27&to=2026-08-27").json()[0]["id"]
    client.post("/api/v1/assistant/act",
                json={"action": "delete_expense", "args": {"expense_id": eid}})

    items = _trash(client)
    assert [i["kind"] for i in items] == ["expense"]
    assert "Fuel" in items[0]["label"]


# ---------------------------------------------------------------------------
# orders — kept, deliberately not auto-restored
# ---------------------------------------------------------------------------
def test_a_deleted_order_is_kept_with_its_lines(client, make_product):
    p = make_product(name="Babka", price="20.00")
    order = client.post("/api/v1/orders",
                        json=order_payload(p["id"], "key-trash-0001")).json()
    client.post(f"/api/v1/orders/{order['id']}/cancel", json={"reverse_stock": True})
    client.delete(f"/api/v1/orders/{order['id']}")

    item = _trash(client)[0]
    assert item["kind"] == "order"
    assert f"#{order['id']}" in item["label"]
    assert "Babka" in item["label"]
    # The lines are in the snapshot so it can be retyped from this record.
    assert item["payload"]["items"][0]["product_name"] == "Babka"


def test_an_order_is_not_offered_for_automatic_restore(client, make_product):
    """Re-inserting one would have to replay stock and payment state; a
    half-right order is worse than retyping it."""
    p = make_product()
    order = client.post("/api/v1/orders",
                        json=order_payload(p["id"], "key-trash-0002")).json()
    client.post(f"/api/v1/orders/{order['id']}/cancel", json={"reverse_stock": True})
    client.delete(f"/api/v1/orders/{order['id']}")

    item = _trash(client)[0]
    assert item["restorable"] is False
    r = client.post(f"/api/v1/trash/{item['id']}/restore")
    assert r.status_code == 400
    assert "re-entered" in r.json()["error"]["message"]


# ---------------------------------------------------------------------------
# merges
# ---------------------------------------------------------------------------
def test_a_merged_away_customer_is_recorded(client, make_product):
    p = make_product()["id"]
    for i, (name, phone) in enumerate([("Herman", "4383705825"), ("Herman Braun", None)]):
        payload = order_payload(p, f"key-trash-100{i}", client_name=name, payment_timing="later")
        payload.pop("payment_method", None)
        payload["client_phone"] = phone
        client.post("/api/v1/orders", json=payload)

    ids = {c["name"]: c["id"] for c in client.get("/api/v1/customers").json()}
    client.post("/api/v1/assistant/act", json={
        "action": "merge_customers",
        "args": {"keep_id": ids["Herman"], "duplicate_id": ids["Herman Braun"]},
    })

    item = _trash(client)[0]
    assert item["kind"] == "customer"
    assert "Herman Braun" in item["label"]
    assert item["payload"]["merged_into"] == ids["Herman"]
    # Not restorable — the orders already moved.
    assert item["restorable"] is False


# ---------------------------------------------------------------------------
# who and when, and who may look
# ---------------------------------------------------------------------------
def test_the_trash_records_who_deleted_it(client):
    cid, eid = _company_with_entry(client)
    client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}")

    item = _trash(client)[0]
    assert item["deleted_by_name"] is not None
    assert item["deleted_at"] is not None


def test_newest_first(client):
    cid, first = _company_with_entry(client)
    second = client.post(f"/api/v1/bookkeeping/companies/{cid}/entries", json={
        "entry_date": "2026-08-02", "type": "charge", "amount": "10.00", "note": "sugar",
    }).json()["entries"][-1]["id"]

    client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{first}")
    client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{second}")

    labels = [i["label"] for i in _trash(client)]
    assert "sugar" in labels[0]
    assert "flour" in labels[1]


def test_the_trash_is_admin_only(make_user, client):
    """It spans every section, so it can't be gated on any one of them."""
    cid, eid = _company_with_entry(client)
    client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}")
    item_id = _trash(client)[0]["id"]

    _, _, manager = make_user("Manager Mo", "manager")
    assert manager.get("/api/v1/trash").status_code == 403
    assert manager.post(f"/api/v1/trash/{item_id}/restore").status_code == 403


def test_restoring_something_that_does_not_exist_is_404(client):
    assert client.post("/api/v1/trash/9999/restore").status_code == 404
