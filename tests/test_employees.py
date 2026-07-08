"""Employee management — Admin only (spec §2G)."""


def test_admin_crud_employee(client):
    r = client.post("/api/v1/employees", json={"name": "gina", "role": "cashier"})
    assert r.status_code == 201
    emp = r.json()
    assert emp["pin_set"] is False and emp["active"] is True

    # promote to manager
    r = client.put(f"/api/v1/employees/{emp['id']}", json={"role": "manager"})
    assert r.status_code == 200
    assert r.json()["role"] == "manager"

    # listing shows active employees (admin + gina)
    names = {e["name"] for e in client.get("/api/v1/employees").json()}
    assert {"admin", "gina"} <= names

    # soft-remove → excluded from default list, present with include_inactive
    assert client.delete(f"/api/v1/employees/{emp['id']}").status_code == 200
    active = {e["name"] for e in client.get("/api/v1/employees").json()}
    assert "gina" not in active
    allof = {e["name"] for e in client.get(
        "/api/v1/employees", params={"include_inactive": True}
    ).json()}
    assert "gina" in allof


def test_non_admin_cannot_manage_employees(client, make_user):
    _, _, manager = make_user("henry", "manager")
    r = manager.post("/api/v1/employees", json={"name": "z", "role": "cashier"})
    assert r.status_code == 403
    assert manager.get("/api/v1/employees").status_code == 403


def test_admin_reset_pin_returns_to_first_login(client, make_user):
    uid, _, larry = make_user("larry", "cashier", pin="5555")
    # works before reset
    assert client.post(
        "/api/v1/auth/login", json={"user_id": uid, "pin": "5555"}
    ).status_code == 200

    # admin resets → back to first-login state, with a fresh setup code
    r = client.post(f"/api/v1/employees/{uid}/reset-pin")
    assert r.status_code == 200
    assert r.json()["pin_set"] is False
    code = r.json()["setup_code"]
    assert code

    # old PIN no longer logs in; login now blocked pending new PIN
    r = client.post("/api/v1/auth/login", json={"user_id": uid, "pin": "5555"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "pin_not_set"

    # employee sets a new PIN (with the issued code) and logs in again
    assert client.post(
        "/api/v1/auth/set-pin",
        json={"user_id": uid, "setup_code": code, "pin": "6666"},
    ).status_code == 204
    assert client.post(
        "/api/v1/auth/login", json={"user_id": uid, "pin": "6666"}
    ).status_code == 200


def test_non_admin_cannot_reset_pin(client, make_user):
    uid, _, _ = make_user("mona", "cashier")
    _, _, manager = make_user("nate", "manager")
    assert manager.post(f"/api/v1/employees/{uid}/reset-pin").status_code == 403


def test_deactivated_employee_cannot_use_token(client, make_user):
    uid, _, ivy = make_user("ivy", "cashier")
    # works before deactivation
    assert ivy.get("/api/v1/products").status_code == 200
    client.delete(f"/api/v1/employees/{uid}")
    # token now rejected (user inactive)
    assert ivy.get("/api/v1/products").status_code == 401
