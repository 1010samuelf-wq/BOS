"""Notifications: low-stock generation, overdue generation, feed (§2H/§10)."""

from datetime import datetime, timedelta, timezone

from tests.conftest import order_payload


def _needed(dt: datetime) -> str:
    return dt.isoformat()


def test_low_stock_generates_notification(client, make_ingredient):
    salt = make_ingredient(name="Salt", threshold="3")
    # stock above threshold first, then drop below → fires on the crossing
    client.post("/api/v1/stock/adjust", json={
        "item_type": "ingredient", "item_id": salt["id"], "delta": "5", "reason": "init"})
    client.post("/api/v1/stock/adjust", json={
        "item_type": "ingredient", "item_id": salt["id"], "delta": "-3", "reason": "use"})

    feed = client.get("/api/v1/notifications", params={"type": "low_stock"}).json()
    assert feed["total"] >= 1
    n = feed["items"][0]
    assert n["type"] == "low_stock"
    assert n["related_item_id"] == salt["id"]
    assert n["read"] is False


def test_overdue_order_generation_and_dedup(client, make_product):
    p = make_product(name="Cake", price="5.00")
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    client.post("/api/v1/orders", json=order_payload(
        p["id"], "notif-ovd1", needed_for_date=_needed(past)))

    # reading the feed refreshes overdue first
    feed = client.get("/api/v1/notifications", params={"type": "overdue_order"}).json()
    assert feed["total"] == 1
    assert feed["items"][0]["related_order_id"] is not None

    # scanning again does NOT create a duplicate
    client.post("/api/v1/notifications/scan")
    feed2 = client.get("/api/v1/notifications", params={"type": "overdue_order"}).json()
    assert feed2["total"] == 1


def test_fulfilled_order_not_flagged_overdue(client, make_product):
    p = make_product(name="Tart", price="4.00")
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    oid = client.post("/api/v1/orders", json=order_payload(
        p["id"], "notif-ful1", needed_for_date=_needed(past))).json()["id"]
    client.post(f"/api/v1/orders/{oid}/fulfill")

    client.post("/api/v1/notifications/scan")
    feed = client.get("/api/v1/notifications", params={"type": "overdue_order"}).json()
    assert feed["total"] == 0


def test_unread_count_and_mark_read(client, make_ingredient):
    salt = make_ingredient(name="Pepper", threshold="3")
    client.post("/api/v1/stock/adjust", json={
        "item_type": "ingredient", "item_id": salt["id"], "delta": "5", "reason": "init"})
    client.post("/api/v1/stock/adjust", json={
        "item_type": "ingredient", "item_id": salt["id"], "delta": "-4", "reason": "use"})

    assert client.get("/api/v1/notifications/unread-count").json()["unread"] >= 1

    nid = client.get("/api/v1/notifications").json()["items"][0]["id"]
    assert client.post(f"/api/v1/notifications/{nid}/read").json()["read"] is True

    # mark-all clears the badge
    client.post("/api/v1/notifications/read-all")
    assert client.get(
        "/api/v1/notifications", params={"unread_only": True}
    ).json()["total"] == 0


def test_overdue_task_generates_notification(client, make_user):
    _, _, _ = make_user("quinn", "cashier")
    # admin assigns a task already past due
    uid = next(e["id"] for e in client.get("/api/v1/employees").json() if e["name"] == "quinn")
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    client.post("/api/v1/tasks", json={
        "description": "Clean the oven", "assigned_to": uid, "due_date": past})

    client.post("/api/v1/notifications/scan")
    feed = client.get("/api/v1/notifications", params={"type": "overdue_task"}).json()
    assert feed["total"] == 1
    assert feed["items"][0]["related_task_id"] is not None
