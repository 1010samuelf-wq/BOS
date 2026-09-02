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


# ---------------------------------------------------------------------------
# editing a line
#
# The shop asked for every line and every company to be editable: a ledger is
# typed at speed and the alternative to editing was delete-and-retype, which
# throws away who logged it and when.
# ---------------------------------------------------------------------------
def _company_with_entry(client, **entry):
    cid = client.post(
        "/api/v1/bookkeeping/companies", json={"name": "Flour Co", "type": "payable"}
    ).json()["id"]
    body = {"entry_date": "2026-08-01", "type": "charge", "amount": "150.00", "note": "flour"}
    body.update(entry)
    eid = client.post(f"/api/v1/bookkeeping/companies/{cid}/entries", json=body).json()["entries"][0]["id"]
    return cid, eid


def test_an_entrys_amount_can_be_corrected(client):
    cid, eid = _company_with_entry(client)
    r = client.put(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}", json={"amount": "175.50"})
    assert r.status_code == 200, r.text

    entry = r.json()["entries"][0]
    assert Decimal(entry["amount"]) == Decimal("175.50")
    assert Decimal(r.json()["balance"]) == Decimal("175.50")
    # Untouched fields survive.
    assert entry["entry_date"] == "2026-08-01"
    assert entry["note"] == "flour"


def test_editing_one_field_does_not_blank_the_others(client):
    """exclude_unset, same reason as orders: a full dump would write None over
    everything the client didn't send."""
    cid, eid = _company_with_entry(client)
    r = client.put(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}", json={"note": "flour + rye"})

    entry = r.json()["entries"][0]
    assert entry["note"] == "flour + rye"
    assert Decimal(entry["amount"]) == Decimal("150.00")
    assert entry["type"] == "charge"
    assert entry["entry_date"] == "2026-08-01"


def test_a_note_can_be_cleared_explicitly(client):
    cid, eid = _company_with_entry(client)
    r = client.put(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}", json={"note": None})
    assert r.json()["entries"][0]["note"] is None


def test_the_date_and_type_can_be_changed(client):
    cid, eid = _company_with_entry(client)
    r = client.put(f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}", json={
        "entry_date": "2026-08-20", "type": "payment",
    })
    entry = r.json()["entries"][0]
    assert entry["entry_date"] == "2026-08-20"
    assert entry["type"] == "payment"
    # A charge flipped to a payment swings the balance the other way.
    assert Decimal(r.json()["balance"]) == Decimal("-150.00")


def test_an_edit_to_a_non_positive_amount_is_refused(client):
    cid, eid = _company_with_entry(client)
    for bad in ("0", "-5"):
        assert client.put(
            f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}", json={"amount": bad}
        ).status_code == 400
    detail = client.get(f"/api/v1/bookkeeping/companies/{cid}").json()
    assert Decimal(detail["entries"][0]["amount"]) == Decimal("150.00")


def test_editing_an_entry_on_the_wrong_company_is_404(client):
    cid, eid = _company_with_entry(client)
    other = client.post(
        "/api/v1/bookkeeping/companies", json={"name": "Sugar Co", "type": "payable"}
    ).json()["id"]
    assert client.put(
        f"/api/v1/bookkeeping/companies/{other}/entries/{eid}", json={"amount": "1"}
    ).status_code == 404


def test_a_company_can_be_renamed_and_redirected(client):
    cid, _ = _company_with_entry(client)
    r = client.put(f"/api/v1/bookkeeping/companies/{cid}",
                   json={"name": "Flour & Grain Co", "type": "receivable"})
    assert r.status_code == 200
    assert r.json()["name"] == "Flour & Grain Co"
    assert r.json()["type"] == "receivable"


def test_editing_needs_the_section(client, make_user):
    cid, eid = _company_with_entry(client)
    _, _, cashier = make_user("cass", "cashier")
    assert cashier.put(
        f"/api/v1/bookkeeping/companies/{cid}/entries/{eid}", json={"amount": "1"}
    ).status_code == 403
