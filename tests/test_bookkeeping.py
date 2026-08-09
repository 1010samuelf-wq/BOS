"""Bookkeeping (spec: accounts payable/receivable ledger per company)."""

from decimal import Decimal


def test_company_starts_with_zero_balance(client):
    r = client.post("/api/v1/bookkeeping/companies", json={"name": "Flour Co", "type": "payable"})
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["balance"]) == Decimal("0")
    assert r.json()["type"] == "payable"


def test_charges_and_payments_compute_balance(client):
    cid = client.post(
        "/api/v1/bookkeeping/companies", json={"name": "Flour Co", "type": "payable"}
    ).json()["id"]

    client.post(f"/api/v1/bookkeeping/companies/{cid}/entries", json={
        "entry_date": "2026-08-01", "type": "charge", "amount": "150.00", "note": "flour order",
    })
    client.post(f"/api/v1/bookkeeping/companies/{cid}/entries", json={
        "entry_date": "2026-08-05", "type": "charge", "amount": "50.00",
    })
    r = client.post(f"/api/v1/bookkeeping/companies/{cid}/entries", json={
        "entry_date": "2026-08-10", "type": "payment", "amount": "100.00",
    })

    assert Decimal(r.json()["balance"]) == Decimal("100.00")  # 150 + 50 - 100
    assert len(r.json()["entries"]) == 3


def test_receivable_company_balance_same_formula(client):
    cid = client.post(
        "/api/v1/bookkeeping/companies", json={"name": "Wedding Client", "type": "receivable"}
    ).json()["id"]
    client.post(f"/api/v1/bookkeeping/companies/{cid}/entries", json={
        "entry_date": "2026-08-01", "type": "charge", "amount": "500.00", "note": "custom cake order",
    })
    r = client.get(f"/api/v1/bookkeeping/companies/{cid}")
    assert Decimal(r.json()["balance"]) == Decimal("500.00")  # they owe us 500


def test_delete_entry_recomputes_balance(client):
    cid = client.post(
        "/api/v1/bookkeeping/companies", json={"name": "Sugar Co", "type": "payable"}
    ).json()["id"]
    entry = client.post(f"/api/v1/bookkeeping/companies/{cid}/entries", json={
        "entry_date": "2026-08-01", "type": "charge", "amount": "80.00",
    }).json()["entries"][0]

    r = client.delete(f"/api/v1/bookkeeping/companies/{cid}/entries/{entry['id']}")
    assert Decimal(r.json()["balance"]) == Decimal("0")
    assert r.json()["entries"] == []


def test_list_companies_excludes_inactive_by_default(client):
    cid = client.post(
        "/api/v1/bookkeeping/companies", json={"name": "Old Vendor", "type": "payable"}
    ).json()["id"]
    client.put(f"/api/v1/bookkeeping/companies/{cid}", json={"active": False})

    active = client.get("/api/v1/bookkeeping/companies").json()
    assert all(c["id"] != cid for c in active)

    all_companies = client.get("/api/v1/bookkeeping/companies", params={"include_inactive": True}).json()
    assert any(c["id"] == cid for c in all_companies)


def test_negative_or_zero_amount_rejected(client):
    cid = client.post(
        "/api/v1/bookkeeping/companies", json={"name": "Flour Co", "type": "payable"}
    ).json()["id"]
    r = client.post(f"/api/v1/bookkeeping/companies/{cid}/entries", json={
        "entry_date": "2026-08-01", "type": "charge", "amount": "0",
    })
    assert r.status_code == 400


def test_unknown_company_404(client):
    assert client.get("/api/v1/bookkeeping/companies/9999").status_code == 404
    r = client.post("/api/v1/bookkeeping/companies/9999/entries", json={
        "entry_date": "2026-08-01", "type": "charge", "amount": "10",
    })
    assert r.status_code == 404


def test_bookkeeping_requires_the_section_not_just_being_logged_in(make_user):
    _, _, cashier = make_user("cass", "cashier")  # bookkeeping isn't in cashier defaults
    assert cashier.get("/api/v1/bookkeeping/companies").status_code == 403


def test_granting_the_section_unlocks_it(client, make_user):
    uid, _, cashier = make_user("cass", "cashier")
    client.put(f"/api/v1/employees/{uid}", json={"permissions": ["orders", "bookkeeping"]})
    assert cashier.get("/api/v1/bookkeeping/companies").status_code == 200


def test_admin_has_bookkeeping_without_being_granted(client):
    # Admins always get every section (app/core/permissions.py::effective_sections).
    assert client.get("/api/v1/bookkeeping/companies").status_code == 200
