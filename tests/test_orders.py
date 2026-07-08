"""Order API + business-logic tests (spec §10)."""

from tests.conftest import order_payload


def test_create_order_computes_total_and_marks_paid(client, make_product):
    p = make_product(price="3.50")
    r = client.post("/api/v1/orders", json=order_payload(p["id"], "key-create-1"))
    assert r.status_code == 201, r.text
    order = r.json()
    assert order["total"] == "7.00"  # 2 × 3.50
    assert order["paid_status"] == "paid"
    assert order["status"] == "pending"
    assert order["fulfillment_status"] == "pending"
    assert order["items"][0]["product_name"] == "Croissant"


def test_idempotent_resubmit_returns_same_order(client, make_product):
    p = make_product()
    body = order_payload(p["id"], "key-idem")
    r1 = client.post("/api/v1/orders", json=body)
    r2 = client.post("/api/v1/orders", json=body)
    assert r1.status_code == 201
    assert r2.status_code == 200  # dedup hit, not a new creation
    assert r1.json()["id"] == r2.json()["id"]


def test_same_key_different_payload_is_conflict(client, make_product):
    p = make_product()
    r1 = client.post("/api/v1/orders", json=order_payload(p["id"], "key-clash"))
    assert r1.status_code == 201
    r2 = client.post(
        "/api/v1/orders",
        json=order_payload(p["id"], "key-clash", client_name="Someone Else"),
    )
    assert r2.status_code == 409
    assert r2.json()["error"]["code"] == "idempotency_conflict"


def test_pay_later_is_unpaid_then_mark_paid(client, make_product):
    p = make_product()
    body = order_payload(
        p["id"], "key-later", payment_timing="later", payment_method=None
    )
    r = client.post("/api/v1/orders", json=body)
    assert r.status_code == 201
    oid = r.json()["id"]
    assert r.json()["paid_status"] == "unpaid"

    # collected as e-transfer on pickup → method recorded for the breakdown
    r2 = client.post(
        f"/api/v1/orders/{oid}/mark-paid", json={"payment_method": "etransfer"}
    )
    assert r2.status_code == 200
    assert r2.json()["paid_status"] == "paid"
    assert r2.json()["paid_by"] is not None
    assert r2.json()["payment_method"] == "etransfer"


def test_mark_paid_without_method_still_works(client, make_product):
    p = make_product()
    body = order_payload(
        p["id"], "later-nom", payment_timing="later", payment_method=None
    )
    oid = client.post("/api/v1/orders", json=body).json()["id"]
    r = client.post(f"/api/v1/orders/{oid}/mark-paid")  # no body
    assert r.status_code == 200
    assert r.json()["paid_status"] == "paid"
    assert r.json()["payment_method"] is None


def test_delivery_requires_address(client, make_product):
    p = make_product()
    body = order_payload(
        p["id"], "key-del-", fulfillment_type="delivery", delivery_price="5.00"
    )
    # no delivery_address → validation error
    r = client.post("/api/v1/orders", json=body)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"

    body["delivery_address"] = "12 Baker St"
    r2 = client.post("/api/v1/orders", json=body)
    assert r2.status_code == 201
    # delivery price rolls into total: 2×3.50 + 5.00
    assert r2.json()["total"] == "12.00"


def test_fulfill_moves_out_of_pipeline(client, make_product):
    p = make_product()
    r = client.post("/api/v1/orders", json=order_payload(p["id"], "key-fulfil"))
    oid = r.json()["id"]

    rf = client.post(f"/api/v1/orders/{oid}/fulfill")
    assert rf.status_code == 200
    assert rf.json()["fulfillment_status"] == "fulfilled"
    assert rf.json()["fulfilled_by"] is not None

    # already fulfilled → 400
    assert client.post(f"/api/v1/orders/{oid}/fulfill").status_code == 400


def test_list_filter_by_date_range_payment_and_exclude_cancelled(client, make_product):
    from datetime import datetime, timezone

    p = make_product(price="10.00")
    # cash order + card order today
    client.post("/api/v1/orders", json=order_payload(p["id"], "drill-cash", payment_method="cash"))
    client.post("/api/v1/orders", json=order_payload(p["id"], "drill-card", payment_method="card"))
    cancel_id = client.post("/api/v1/orders", json=order_payload(p["id"], "drill-cxl")).json()["id"]
    client.post(f"/api/v1/orders/{cancel_id}/cancel", json={"reverse_stock": False})

    today = datetime.now(timezone.utc).date().isoformat()

    # date range covers today → all 3 orders
    assert client.get("/api/v1/orders", params={"from": today, "to": today}).json()["total"] == 3
    # exclude cancelled → 2
    r = client.get("/api/v1/orders", params={"from": today, "to": today, "exclude_cancelled": True})
    assert r.json()["total"] == 2
    # payment_method=card → 1 (the card order)
    r = client.get("/api/v1/orders", params={"payment_method": "card"})
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["payment_method"] == "card"
    # a range in the far past → 0
    assert client.get("/api/v1/orders", params={"from": "2000-01-01", "to": "2000-01-02"}).json()["total"] == 0


def test_list_filter_by_product_name(client, make_product):
    croissant = make_product(name="Croissant")
    muffin = make_product(name="Muffin", price="2.00")
    client.post("/api/v1/orders", json=order_payload(croissant["id"], "k1-padke"))
    client.post("/api/v1/orders", json=order_payload(muffin["id"], "k2-padke"))

    r = client.get("/api/v1/orders", params={"product_name": "crois"})
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["items"][0]["product_name"] == "Croissant"


def test_row_lock_blocks_other_user(client, make_product, make_user):
    _, _, alice_client = make_user("alice", "cashier")

    p = make_product()
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "k-lock-p")).json()["id"]

    # alice acquires the lock
    assert alice_client.post(f"/api/v1/orders/{oid}/lock").status_code == 200

    # admin (default client) tries to edit → 409 order_locked
    r_edit = client.put(f"/api/v1/orders/{oid}", json={"client_name": "Hijack"})
    assert r_edit.status_code == 409
    assert r_edit.json()["error"]["code"] == "order_locked"

    # alice can still edit her own locked order
    r_own = alice_client.put(
        f"/api/v1/orders/{oid}", json={"client_name": "Updated"}
    )
    assert r_own.status_code == 200


def test_add_note_and_toggle_done(client, make_product):
    p = make_product()
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "note-flow")).json()["id"]

    # add a note to the existing order
    r = client.post(f"/api/v1/orders/{oid}/notes", json={"text": "they come and sit"})
    assert r.status_code == 200
    notes = r.json()["notes"]
    assert len(notes) == 1
    note_id = notes[0]["id"]
    assert notes[0]["done"] is False

    # check it done → records who + when, stays visible
    r = client.post(f"/api/v1/orders/{oid}/notes/{note_id}/done")
    n = next(x for x in r.json()["notes"] if x["id"] == note_id)
    assert n["done"] is True
    assert n["done_by"] is not None and n["done_at"] is not None

    # toggle back off
    r = client.post(f"/api/v1/orders/{oid}/notes/{note_id}/done")
    n = next(x for x in r.json()["notes"] if x["id"] == note_id)
    assert n["done"] is False
    assert n["done_by"] is None

    # unknown note → 404
    assert client.post(f"/api/v1/orders/{oid}/notes/9999/done").status_code == 404


def test_edit_reprices_on_item_change(client, make_product):
    p = make_product(price="3.50")
    q = make_product(name="Baguette", price="2.00")
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "k-edit-p")).json()["id"]

    r = client.put(
        f"/api/v1/orders/{oid}",
        json={"items": [{"product_id": q["id"], "quantity": 3}]},
    )
    assert r.status_code == 200
    assert r.json()["total"] == "6.00"  # 3 × 2.00
    assert r.json()["items"][0]["product_name"] == "Baguette"
