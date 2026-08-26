"""Offline write-queue replay (POST /sync/replay) — dedup, conflict, permission
checks. The tablet's local outbox is untested here (that's a tablet-side unit
test); this covers the backend contract it replays against.
"""

from app.core.security import create_access_token
from tests.conftest import order_payload


def _op(client_op_id, type_, acting_user_id, payload, expected_updated_at=None):
    return {
        "client_op_id": client_op_id,
        "type": type_,
        "acting_user_id": acting_user_id,
        "payload": payload,
        "expected_updated_at": expected_updated_at,
    }


def _replay(client, ops, device_id="tablet-1-test"):
    return client.post(
        "/api/v1/sync/replay", json={"device_id": device_id, "operations": ops}
    )


def _admin_id(client):
    return client.get("/api/v1/auth/roster").json()[0]["id"]


def test_create_order_applies_and_dedups_on_replay(client, make_product):
    p = make_product()
    admin_id = _admin_id(client)
    payload = order_payload(p["id"], "sync-create-key-01")
    op = _op("client-op-001", "orders.create", admin_id, payload)

    r1 = _replay(client, [op])
    assert r1.status_code == 200, r1.text
    result1 = r1.json()["results"][0]
    assert result1["status"] == "applied"
    order_id = result1["data"]["id"]

    # Replaying the identical op (e.g. app restart mid-sync) must not create
    # a second order — dedup hit on client_op_id, same fingerprint.
    r2 = _replay(client, [op])
    result2 = r2.json()["results"][0]
    assert result2["status"] == "already_applied"
    assert result2["data"]["id"] == order_id

    rows = client.get("/api/v1/orders", params={"limit": 100}).json()["items"]
    assert sum(1 for o in rows if o["id"] == order_id) == 1


def test_same_client_op_id_different_payload_is_rejected(client, make_product):
    p = make_product()
    admin_id = _admin_id(client)
    op1 = _op("client-op-002", "orders.create", admin_id, order_payload(p["id"], "sync-create-key-02"))
    _replay(client, [op1])

    op2 = _op("client-op-002", "orders.create", admin_id, order_payload(p["id"], "sync-create-key-02-b"))
    r = _replay(client, [op2])
    result = r.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error"]["code"] == "idempotency_conflict"


def test_stale_order_update_returns_conflict_with_current_state(client, make_product):
    p = make_product()
    admin_id = _admin_id(client)
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "sync-cas-key-01")).json()["id"]

    # OrderOut doesn't expose updated_at, so capture it directly, mirroring
    # what the tablet would have cached from its own local copy of the order.
    from app.database import SessionLocal
    from app.models import Order

    with SessionLocal() as db:
        stale_ts = db.get(Order, oid).updated_at.isoformat()

    # Someone else edits the order live (simulates the other tablet, or this
    # one before going offline) — updated_at moves forward.
    r = client.put(f"/api/v1/orders/{oid}", json={"client_name": "Changed Live"})
    assert r.status_code == 200

    op = _op(
        "client-op-003", "orders.update", admin_id,
        {"order_id": oid, "client_name": "Changed Offline"},
        expected_updated_at=stale_ts,
    )
    result = _replay(client, [op]).json()["results"][0]
    assert result["status"] == "conflict"
    assert result["error"]["code"] == "stale_version"
    assert result["current"]["client_name"] == "Changed Live"

    # The offline edit must NOT have been applied over the live one.
    current = client.get(f"/api/v1/orders/{oid}").json()
    assert current["client_name"] == "Changed Live"


def test_matching_expected_updated_at_applies_cleanly(client, make_product):
    p = make_product()
    admin_id = _admin_id(client)
    oid = client.post("/api/v1/orders", json=order_payload(p["id"], "sync-cas-key-02")).json()["id"]

    from app.database import SessionLocal
    from app.models import Order

    with SessionLocal() as db:
        current_ts = db.get(Order, oid).updated_at.isoformat()

    op = _op(
        "client-op-004", "orders.update", admin_id,
        {"order_id": oid, "client_name": "Edited While Offline"},
        expected_updated_at=current_ts,
    )
    result = _replay(client, [op]).json()["results"][0]
    assert result["status"] == "applied"
    assert result["data"]["client_name"] == "Edited While Offline"


def test_clock_in_then_out_apply_and_second_clock_in_is_rejected(client, make_user):
    uid, _, _ = make_user("olive", "cashier")
    op_in = _op("client-op-005", "time.clock_in", uid, {})
    r1 = _replay(client, [op_in]).json()["results"][0]
    assert r1["status"] == "applied"

    # A second clock-in queued before the first synced (e.g. tapped twice
    # offline) must not silently succeed — it's a real business-rule reject,
    # not a duplicate-safe dedup (different client_op_id, so no dedup hit).
    op_in_again = _op("client-op-006", "time.clock_in", uid, {})
    r2 = _replay(client, [op_in_again]).json()["results"][0]
    assert r2["status"] == "rejected"
    assert r2["error"]["code"] == "already_clocked_in"

    op_out = _op("client-op-007", "time.clock_out", uid, {})
    r3 = _replay(client, [op_out]).json()["results"][0]
    assert r3["status"] == "applied"


def test_forbidden_when_actor_lacks_section(client, make_user):
    uid, _, _ = make_user("pat", "cashier")
    # Strip every section override — cashier's defaults would otherwise
    # include "orders".
    client.put(f"/api/v1/employees/{uid}", json={"permissions": []})

    op = _op("client-op-008", "orders.cancel", uid, {"order_id": 1, "reverse_stock": False})
    result = _replay(client, [op]).json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error"]["code"] == "forbidden"


def test_rejected_when_actor_deactivated(client, make_user):
    uid, _, _ = make_user("sam", "cashier")
    client.delete(f"/api/v1/employees/{uid}")  # soft-deactivate

    op = _op("client-op-009", "time.clock_in", uid, {})
    result = _replay(client, [op]).json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error"]["code"] == "actor_inactive"


def test_unknown_op_type_is_rejected(client):
    admin_id = _admin_id(client)
    op = _op("client-op-010", "bogus.type", admin_id, {})
    result = _replay(client, [op]).json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error"]["code"] == "unknown_op_type"


def test_task_set_done_rejects_completing_someone_elses_task(client, make_user):
    manager_id = _admin_id(client)
    owner_id, _, _ = make_user("owner", "cashier")
    other_id, _, _ = make_user("other", "cashier")

    task_id = client.post(
        "/api/v1/tasks",
        json={"title": "Clean the mixer", "assigned_to": owner_id},
    ).json()["id"]

    op = _op("client-op-011", "tasks.set_done", other_id, {"task_id": task_id, "done": True})
    result = _replay(client, [op]).json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error"]["code"] == "forbidden"

    # The assignee themself can, though.
    op2 = _op("client-op-012", "tasks.set_done", owner_id, {"task_id": task_id, "done": True})
    result2 = _replay(client, [op2]).json()["results"][0]
    assert result2["status"] == "applied"
    assert result2["data"]["done"] is True


def test_batch_processes_in_order_and_one_failure_does_not_block_others(client, make_product):
    p = make_product()
    admin_id = _admin_id(client)
    good1 = _op("client-op-013", "orders.create", admin_id, order_payload(p["id"], "sync-batch-key-01"))
    bad = _op("client-op-014", "bogus.type", admin_id, {})
    good2 = _op("client-op-015", "orders.create", admin_id, order_payload(p["id"], "sync-batch-key-02"))

    results = _replay(client, [good1, bad, good2]).json()["results"]
    assert [r["status"] for r in results] == ["applied", "rejected", "applied"]
