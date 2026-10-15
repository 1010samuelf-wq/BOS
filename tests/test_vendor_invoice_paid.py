"""Marking a vendor invoice paid: a payment on the ledger and an expense in Reports."""

from decimal import Decimal

B = "/api/v1/bookkeeping/companies"


def _vendor_with_invoice(client, amount="420.50", number="INV-0042", date="2026-10-01"):
    cid = client.post(B, json={"name": "Flour Co", "type": "payable"}).json()["id"]
    detail = client.post(f"{B}/{cid}/entries", json={
        "entry_date": date, "type": "charge", "amount": amount, "invoice_number": number,
    }).json()
    return cid, detail["entries"][0]["id"]


def _summary(client, day):
    return client.get("/api/v1/reports/summary", params={"from": day, "to": day}).json()


def test_mark_paid_records_the_payment_and_an_expense_on_the_day_paid(client):
    cid, eid = _vendor_with_invoice(client)
    r = client.post(f"{B}/{cid}/entries/{eid}/mark-paid", json={"paid_on": "2026-10-10"})
    assert r.status_code == 200, r.text
    body = r.json()

    invoice = next(e for e in body["entries"] if e["id"] == eid)
    assert invoice["paid_on"] == "2026-10-10"
    payment = next(e for e in body["entries"] if e["type"] == "payment")
    assert (payment["entry_date"], Decimal(payment["amount"]), payment["invoice_number"]) == (
        "2026-10-10", Decimal("420.50"), "INV-0042")
    assert Decimal(body["balance"]) == Decimal("0")

    # In Reports on the day the money left — not on the invoice date.
    paid_day = _summary(client, "2026-10-10")
    assert Decimal(paid_day["expenses_total"]) == Decimal("420.50")
    assert paid_day["expenses"][0]["description"] == "Flour Co — invoice INV-0042"
    assert paid_day["expenses"][0]["category"] == "Vendor invoices"
    assert Decimal(_summary(client, "2026-10-01")["expenses_total"]) == Decimal("0")


def test_paid_on_defaults_to_today(client):
    from app.models.base import utc_today

    cid, eid = _vendor_with_invoice(client)
    body = client.post(f"{B}/{cid}/entries/{eid}/mark-paid", json={}).json()
    assert next(e for e in body["entries"] if e["id"] == eid)["paid_on"] == utc_today().isoformat()


def test_an_invoice_cant_be_paid_twice(client):
    cid, eid = _vendor_with_invoice(client)
    client.post(f"{B}/{cid}/entries/{eid}/mark-paid", json={"paid_on": "2026-10-10"})
    r = client.post(f"{B}/{cid}/entries/{eid}/mark-paid", json={"paid_on": "2026-10-11"})
    assert r.status_code == 400
    assert Decimal(_summary(client, "2026-10-11")["expenses_total"]) == Decimal("0")


def test_undo_removes_both_and_records_them_to_the_trash(client):
    cid, eid = _vendor_with_invoice(client)
    client.post(f"{B}/{cid}/entries/{eid}/mark-paid", json={"paid_on": "2026-10-10"})

    r = client.post(f"{B}/{cid}/entries/{eid}/unmark-paid")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [e["type"] for e in body["entries"]] == ["charge"]
    assert body["entries"][0]["paid_on"] is None
    assert Decimal(body["balance"]) == Decimal("420.50")
    assert Decimal(_summary(client, "2026-10-10")["expenses_total"]) == Decimal("0")

    kinds = sorted(t["kind"] for t in client.get("/api/v1/trash").json())
    assert kinds == ["expense", "ledger_entry"]


def test_only_a_vendor_charge_can_be_marked_paid(client):
    cust = client.post(B, json={"name": "Shul", "type": "receivable"}).json()["id"]
    eid = client.post(f"{B}/{cust}/entries", json={
        "entry_date": "2026-10-01", "type": "charge", "amount": "50"}).json()["entries"][0]["id"]
    assert client.post(f"{B}/{cust}/entries/{eid}/mark-paid", json={}).status_code == 400

    cid, _ = _vendor_with_invoice(client)
    pid = client.post(f"{B}/{cid}/entries", json={
        "entry_date": "2026-10-02", "type": "payment", "amount": "10"}).json()["entries"][-1]["id"]
    assert client.post(f"{B}/{cid}/entries/{pid}/mark-paid", json={}).status_code == 400


def test_the_linked_rows_cant_be_deleted_one_at_a_time(client):
    cid, eid = _vendor_with_invoice(client)
    body = client.post(f"{B}/{cid}/entries/{eid}/mark-paid", json={"paid_on": "2026-10-10"}).json()
    payment_id = next(e["id"] for e in body["entries"] if e["type"] == "payment")
    expense_id = _summary(client, "2026-10-10")["expenses"][0]["id"]

    assert client.delete(f"{B}/{cid}/entries/{eid}").status_code == 400
    assert client.delete(f"{B}/{cid}/entries/{payment_id}").status_code == 400
    assert client.delete(f"/api/v1/expenses/{expense_id}").status_code == 400

    # After undo, the invoice can be deleted normally.
    client.post(f"{B}/{cid}/entries/{eid}/unmark-paid")
    assert client.delete(f"{B}/{cid}/entries/{eid}").status_code == 200


def test_an_ordinary_expense_still_deletes(client):
    e = client.post("/api/v1/expenses", json={"description": "Gas", "amount": "40", "spent_on": "2026-10-10"}).json()
    assert client.delete(f"/api/v1/expenses/{e['id']}").status_code == 204
