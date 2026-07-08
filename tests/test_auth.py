"""Auth: PIN setup, login, JWT, and role enforcement (spec §2E, §6)."""

from tests.conftest import order_payload


def _create_employee(client, name, role="cashier"):
    r = client.post("/api/v1/employees", json={"name": name, "role": role})
    assert r.status_code == 201, r.text
    return r.json()


def test_first_login_pin_setup_then_login(client):
    emp = _create_employee(client, "bob", "manager")
    assert emp["pin_set"] is False

    # login before PIN is set → 403 pin_not_set
    r = client.post("/api/v1/auth/login", json={"user_id": emp["id"], "pin": "9999"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "pin_not_set"

    # employee sets their own PIN (unauthenticated by design)
    r = client.post("/api/v1/auth/set-pin", json={"user_id": emp["id"], "pin": "9999"})
    assert r.status_code == 204

    # setting again → 409
    r = client.post("/api/v1/auth/set-pin", json={"user_id": emp["id"], "pin": "0000"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "pin_already_set"

    # now login works and returns a usable token
    r = client.post("/api/v1/auth/login", json={"user_id": emp["id"], "pin": "9999"})
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["role"] == "manager"
    assert body["access_token"]


def test_roster_is_public_and_minimal(client, anon_client):
    _create_employee(client, "roster-bob", "cashier")
    # unauthenticated access works (pre-login picker)
    r = anon_client.get("/api/v1/auth/roster")
    assert r.status_code == 200
    entry = next(e for e in r.json() if e["name"] == "roster-bob")
    assert entry["pin_set"] is False
    assert set(entry.keys()) == {"id", "name", "role", "pin_set"}  # no pin/hash


def test_login_wrong_pin_is_401(client):
    emp = _create_employee(client, "carol")
    client.post("/api/v1/auth/set-pin", json={"user_id": emp["id"], "pin": "1234"})
    r = client.post("/api/v1/auth/login", json={"user_id": emp["id"], "pin": "0000"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"


def test_protected_endpoint_requires_token(anon_client, make_product):
    # no Authorization header → 401 on a protected route
    r = anon_client.get("/api/v1/orders")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_invalid_token_is_401(make_product):
    from tests.conftest import _client_with_token

    bad = _client_with_token("not-a-real-jwt")
    r = bad.get("/api/v1/orders")
    assert r.status_code == 401


def test_cashier_cannot_adjust_stock_or_edit_catalog(client, make_ingredient, make_user):
    ing = make_ingredient(name="Butter")
    _, _, cashier = make_user("dan", "cashier")

    # cashier blocked from stock adjust (manager+) and product create (admin)
    r = cashier.post(
        "/api/v1/stock/adjust",
        json={"item_type": "ingredient", "item_id": ing["id"],
              "delta": "1", "reason": "x"},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"

    r = cashier.post("/api/v1/products", json={"name": "X", "price": "1.00"})
    assert r.status_code == 403


def test_cashier_can_take_orders(client, make_product, make_user):
    p = make_product()
    _, _, cashier = make_user("erin", "cashier")
    r = cashier.post("/api/v1/orders", json=order_payload(p["id"], "cashier-1"))
    assert r.status_code == 201


def test_manager_can_adjust_stock_but_not_catalog(client, make_ingredient, make_user):
    ing = make_ingredient(name="Milk")
    _, _, manager = make_user("frank", "manager")

    r = manager.post(
        "/api/v1/stock/adjust",
        json={"item_type": "ingredient", "item_id": ing["id"],
              "delta": "3", "reason": "restock"},
    )
    assert r.status_code == 200

    # catalog stays admin-only
    r = manager.post("/api/v1/products", json={"name": "Y", "price": "2.00"})
    assert r.status_code == 403
