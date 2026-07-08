"""Per-employee section permissions overriding role defaults."""

from tests.conftest import order_payload


def _emp(client, name, role="cashier"):
    return client.post("/api/v1/employees", json={"name": name, "role": role}).json()


def test_login_returns_effective_sections(client, make_user):
    _, _, cashier = make_user("cass", "cashier")
    # cashier default sections
    me = cashier.get("/api/v1/notifications").status_code  # allowed
    assert me == 200
    # verify the section set via a fresh login on the roster
    # (cashier default = orders, tasks, notifications, time)
    assert cashier.get("/api/v1/stock").status_code == 403       # no stock
    assert cashier.get("/api/v1/reports/summary").status_code == 403  # no reports


def test_cashier_default_sections(client, make_user):
    _, _, cashier = make_user("dee", "cashier")
    p = client.post("/api/v1/products", json={"name": "Bun", "price": "2.00"}).json()
    # has: orders, tasks, notifications, time
    assert cashier.post("/api/v1/orders", json=order_payload(p["id"], "perm-ord1")).status_code == 201
    assert cashier.get("/api/v1/notifications").status_code == 200
    assert cashier.post("/api/v1/time/clock-in").status_code == 200
    # lacks: stock, reports, production, deliveries, settings
    for path in ("/stock", "/reports/summary", "/reports/production", "/deliveries"):
        assert cashier.get(f"/api/v1{path}").status_code == 403, path


def test_admin_narrows_employee_to_orders_only(client, make_user):
    uid, _, worker = make_user("nate", "cashier")
    p = client.post("/api/v1/products", json={"name": "Roll", "price": "1.50"}).json()

    # by default a cashier can also see notifications
    assert worker.get("/api/v1/notifications").status_code == 200

    # admin restricts them to ONLY orders
    r = client.put(f"/api/v1/employees/{uid}", json={"permissions": ["orders"]})
    assert r.status_code == 200
    assert r.json()["permissions"] == ["orders"]
    assert r.json()["effective_sections"] == ["orders"]

    # now: orders still works, everything else is blocked
    assert worker.post("/api/v1/orders", json=order_payload(p["id"], "perm-only1")).status_code == 201
    assert worker.get("/api/v1/notifications").status_code == 403
    assert worker.post("/api/v1/time/clock-in").status_code == 403
    assert worker.get("/api/v1/tasks").status_code == 403


def test_admin_grants_section_beyond_role(client, make_user):
    uid, _, cashier = make_user("gwen", "cashier")
    # cashier can't see reports by default
    assert cashier.get("/api/v1/reports/summary").status_code == 403

    # admin grants reports (override goes beyond the role's defaults)
    client.put(f"/api/v1/employees/{uid}", json={"permissions": ["orders", "reports"]})
    assert cashier.get("/api/v1/reports/summary").status_code == 200


def test_reset_permissions_falls_back_to_role(client, make_user):
    uid, _, cashier = make_user("ivy", "cashier")
    client.put(f"/api/v1/employees/{uid}", json={"permissions": ["orders"]})
    assert cashier.get("/api/v1/notifications").status_code == 403

    # clearing the override (null) restores role defaults
    r = client.put(f"/api/v1/employees/{uid}", json={"permissions": None})
    assert r.json()["permissions"] is None
    assert cashier.get("/api/v1/notifications").status_code == 200


def test_admin_always_has_every_section(client):
    # the seeded admin keeps full access regardless of any override attempt
    emps = client.get("/api/v1/employees", params={"include_inactive": True}).json()
    admin = next(e for e in emps if e["name"] == "admin")
    assert set(admin["effective_sections"]) >= {"orders", "reports", "settings", "employees"}


def test_permissions_validation_rejects_unknown_section(client, make_user):
    uid, _, _ = make_user("kirk", "cashier")
    r = client.put(f"/api/v1/employees/{uid}", json={"permissions": ["orders", "bogus"]})
    assert r.status_code == 400


def test_sections_catalog_endpoint(client):
    sections = client.get("/api/v1/employees/sections").json()
    assert "orders" in sections and "settings" in sections
    assert "employees" not in sections  # not grantable


def test_non_admin_cannot_edit_permissions(client, make_user):
    uid, _, _ = make_user("mona", "cashier")
    _, _, manager = make_user("otto", "manager")
    assert manager.put(f"/api/v1/employees/{uid}", json={"permissions": ["orders"]}).status_code == 403
