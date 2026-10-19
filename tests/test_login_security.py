"""PIN login hardening: the row lock, the per-address lockout, the login rate
limit, the public roster, longer PINs for admins/managers, and who may take a
payment back off an order."""

import threading
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.core.ratelimit import login_limiter
from app.database import SessionLocal, engine
from app.models import Notification, User
from app.models.base import utcnow
from app.schemas.auth import LoginIn
from app.services import auth as auth_service
from tests.conftest import ADMIN_PIN, order_payload

LOGIN = "/api/v1/auth/login"


def _login(client, ip, pin, **who):
    return client.post(LOGIN, json={**who, "pin": pin}, headers={"fly-client-ip": ip})


def _admin_id():
    with SessionLocal() as db:
        return db.scalar(select(User.id).where(User.name == "admin"))


@pytest.fixture
def login_limits(monkeypatch):
    """Switch the per-IP limit on (the suite runs with it off) from a clean
    slate, and leave it clean for whoever runs next."""
    settings = get_settings()

    def _set(per_minute, per_hour):
        monkeypatch.setattr(settings, "login_rate_per_minute", per_minute)
        monkeypatch.setattr(settings, "login_rate_per_hour", per_hour)

    login_limiter.reset()
    yield _set
    login_limiter.reset()


# ---------------------------------------------------------------------------
# 1. the row lock
# ---------------------------------------------------------------------------
@pytest.mark.skipif(
    engine.dialect.name != "postgresql",
    reason="SQLite has no row locks; run with BOS_DATABASE_URL pointing at Postgres",
)
def test_sixty_concurrent_wrong_pins_check_at_most_five(make_user, monkeypatch):
    """Without SELECT ... FOR UPDATE every one of these reads the same failure
    count before any writes it back, so all sixty get a guess. With it they
    queue on the employee's row and the sixth onwards finds it locked."""
    uid, _, _ = make_user("target", "cashier", pin="1111")

    checked = 0
    count_lock = threading.Lock()
    real_verify = auth_service.verify_pin

    def counting_verify(pin, hashed):
        nonlocal checked
        with count_lock:
            checked += 1
        return real_verify(pin, hashed)

    monkeypatch.setattr(auth_service, "verify_pin", counting_verify)

    start = threading.Barrier(60)
    outcomes: list[str] = []

    def guess(n):
        db = SessionLocal()
        try:
            start.wait()
            auth_service.login(db, LoginIn(user_id=uid, pin=f"{n:04d}9"), "198.51.100.1")
            outcomes.append("ok")
        except Exception as e:  # noqa: BLE001 — the outcome is what's asserted
            outcomes.append(getattr(e, "code", type(e).__name__))
            db.rollback()
        finally:
            db.close()

    threads = [threading.Thread(target=guess, args=(n,)) for n in range(60)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(outcomes) == 60
    assert "ok" not in outcomes
    assert checked <= 5, f"{checked} PINs were checked"
    assert outcomes.count("invalid_credentials") == checked
    assert outcomes.count("account_locked") == 60 - checked


# ---------------------------------------------------------------------------
# 3. the lockout is per address
# ---------------------------------------------------------------------------
def test_a_stranger_only_locks_themselves_out(client, make_user):
    uid, _, _ = make_user("rivka", "cashier", pin="1234")
    for _ in range(5):
        assert _login(client, "203.0.113.9", "0000", user_id=uid).status_code == 401
    r = _login(client, "203.0.113.9", "1234", user_id=uid)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "account_locked"

    # The shop's own connection is untouched.
    assert _login(client, "198.51.100.1", "1234", user_id=uid).status_code == 200


def test_a_right_pin_clears_that_address_count(client, make_user):
    uid, _, _ = make_user("chana", "cashier", pin="1234")
    for _ in range(4):
        assert _login(client, "198.51.100.1", "0000", user_id=uid).status_code == 401
    assert _login(client, "198.51.100.1", "1234", user_id=uid).status_code == 200
    for _ in range(4):
        assert _login(client, "198.51.100.1", "0000", user_id=uid).status_code == 401
    assert _login(client, "198.51.100.1", "1234", user_id=uid).status_code == 200


def test_guessing_from_many_addresses_hits_a_ceiling_but_not_the_shop(client, make_user):
    """Five tries an address would let someone with a few hundred addresses walk
    a 4-digit PIN. The employee-wide ceiling stops that — for addresses that have
    never signed in as this employee. The shop's device keeps working."""
    uid, _, _ = make_user("esti", "cashier", pin="1234")
    shop = "198.51.100.1"
    assert _login(client, shop, "1234", user_id=uid).status_code == 200  # known device

    ceiling = get_settings().login_max_attempts_per_employee
    per_ip = get_settings().login_max_attempts
    for n in range(ceiling):
        ip = f"203.0.113.{n // (per_ip - 1)}"  # never enough on one IP to lock it
        assert _login(client, ip, "0000", user_id=uid).status_code == 401

    # A fresh address with the right PIN is refused...
    r = _login(client, "192.0.2.77", "1234", user_id=uid)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "account_locked"
    # ...but the shop's tablet is not.
    assert _login(client, shop, "1234", user_id=uid).status_code == 200


def test_reset_pin_lifts_every_address_lock(client, make_user):
    uid, _, _ = make_user("dina", "cashier", pin="1234")
    for _ in range(5):
        _login(client, "203.0.113.9", "0000", user_id=uid)
    code = client.post(f"/api/v1/employees/{uid}/reset-pin").json()["setup_code"]
    r = client.post(
        "/api/v1/auth/set-pin", json={"user_id": uid, "setup_code": code, "pin": "4321"}
    )
    assert r.status_code == 204, r.text
    assert _login(client, "203.0.113.9", "4321", user_id=uid).status_code == 200


# ---------------------------------------------------------------------------
# 2. the per-IP rate limit
# ---------------------------------------------------------------------------
def test_login_is_limited_per_minute(client, make_user, login_limits):
    login_limits(per_minute=10, per_hour=50)
    uids = [make_user(f"p{n}", "cashier", pin="1234")[0] for n in range(3)]
    codes = [
        _login(client, "203.0.113.5", "0000", user_id=uids[n % 3]).status_code
        for n in range(11)
    ]
    assert codes[:10] == [401] * 10
    assert codes[10] == 429
    # Another address is counted separately.
    assert _login(client, "198.51.100.1", "1234", user_id=uids[0]).status_code == 200


def test_right_pins_dont_use_up_the_limit(client, make_user, login_limits):
    """The whole shop shares one address and logs in all day."""
    login_limits(per_minute=10, per_hour=50)
    uid, _, _ = make_user("busy", "cashier", pin="1234")
    for _ in range(25):
        assert _login(client, "198.51.100.1", "1234", user_id=uid).status_code == 200


def test_login_is_limited_per_hour(client, make_user, login_limits):
    login_limits(per_minute=0, per_hour=50)
    uids = [make_user(f"h{n}", "cashier", pin="1234")[0] for n in range(11)]
    codes = [
        _login(client, "203.0.113.5", "0000", user_id=uids[n % 11]).status_code
        for n in range(51)
    ]
    assert 429 not in codes[:50]
    assert codes[50] == 429


# ---------------------------------------------------------------------------
# 4. the public roster
# ---------------------------------------------------------------------------
def test_roster_lists_everyone_but_no_roles(client, anon_client, make_user):
    make_user("manny", "manager", pin="123456")
    make_user("cass", "cashier", pin="1234")
    roster = anon_client.get("/api/v1/auth/roster").json()
    assert {"admin", "manny", "cass"} <= {e["name"] for e in roster}
    # No real role: the list doesn't say which accounts are worth guessing.
    assert {e["role"] for e in roster} == {"staff"}


def test_staff_list_has_everyone_but_needs_a_session(client, anon_client, make_user):
    make_user("cass", "cashier", pin="1234")
    assert anon_client.get("/api/v1/auth/staff").status_code == 401
    names = {e["name"] for e in client.get("/api/v1/auth/staff").json()}
    assert {"admin", "cass"} <= names


def test_an_admin_signs_in_by_name(client, make_user):
    make_user("Shira Admin", "admin", pin="246810")
    r = _login(client, "198.51.100.1", "246810", name="  shira   ADMIN ")
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "admin"
    assert _login(client, "198.51.100.1", "000000", name="Shira Admin").status_code == 401
    assert _login(client, "198.51.100.1", "246810", name="Nobody").status_code == 401


# ---------------------------------------------------------------------------
# 5. six-digit PINs for admins and managers
# ---------------------------------------------------------------------------
def test_short_admin_pin_must_be_changed_before_a_session(client):
    admin_id = _admin_id()
    # ADMIN_PIN is the seeded 4-digit PIN: it's right, but not enough any more.
    r = _login(client, "198.51.100.1", ADMIN_PIN, user_id=admin_id)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "pin_change_required"
    assert "access_token" not in r.json()

    change = "/api/v1/auth/change-pin"
    body = {"user_id": admin_id, "current_pin": ADMIN_PIN}
    r = client.post(change, json={**body, "new_pin": "5678"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "pin_too_short"
    r = client.post(change, json={**body, "current_pin": "0000", "new_pin": "135792"})
    assert r.status_code == 401
    r = client.post(change, json={**body, "new_pin": "135792"})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]

    # The old session (the `client` fixture's token) is retired by the change.
    assert client.get("/api/v1/auth/staff").status_code == 401
    assert _login(client, "198.51.100.1", "135792", user_id=admin_id).status_code == 200
    assert _login(client, "198.51.100.1", ADMIN_PIN, user_id=admin_id).status_code == 401


def test_cashiers_keep_four_digit_pins(client, make_user):
    uid, _, _ = make_user("baker", "cashier", pin="1234")
    assert _login(client, "198.51.100.1", "1234", user_id=uid).status_code == 200


def test_a_new_manager_must_choose_six_digits(client):
    emp = client.post("/api/v1/employees", json={"name": "mgr", "role": "manager"}).json()
    body = {"user_id": emp["id"], "setup_code": emp["setup_code"]}
    r = client.post("/api/v1/auth/set-pin", json={**body, "pin": "1234"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "pin_too_short"
    assert client.post("/api/v1/auth/set-pin", json={**body, "pin": "123456"}).status_code == 204


# ---------------------------------------------------------------------------
# 6. taking a payment back off an order
# ---------------------------------------------------------------------------
def test_only_a_manager_can_delete_a_payment_and_it_is_announced(client, make_product, make_user, db):
    p = make_product(price="3.50")
    order = client.post("/api/v1/orders", json=order_payload(p["id"], "k-del-pay")).json()
    payment_id = order["payments"][0]["id"]
    url = f"/api/v1/orders/{order['id']}/payments/{payment_id}"

    _, _, cashier = make_user("cash", "cashier")
    r = cashier.delete(url)
    assert r.status_code == 403
    assert len(client.get(f"/api/v1/orders/{order['id']}").json()["payments"]) == 1

    _, _, manager = make_user("boss", "manager")
    r = manager.delete(url)
    assert r.status_code == 200, r.text
    assert r.json()["payments"] == []
    assert Decimal(r.json()["balance_due"]) == Decimal("7.00")

    notes = db.scalars(select(Notification).where(Notification.type == "payment_deleted")).all()
    assert len(notes) == 1
    assert notes[0].related_order_id == order["id"]
    assert "boss" in notes[0].message and "$7.00" in notes[0].message


# ---------------------------------------------------------------------------
# PIN changes and attacks are announced
# ---------------------------------------------------------------------------
def _notes(kind):
    with SessionLocal() as db:
        return [n.message for n in db.scalars(
            select(Notification).where(Notification.type == kind).order_by(Notification.id)
        )]


def test_an_admin_changing_their_pin_is_announced_with_the_address(client):
    admin_id = _admin_id()
    r = client.post(
        "/api/v1/auth/change-pin",
        json={"user_id": admin_id, "current_pin": ADMIN_PIN, "new_pin": "135792"},
        headers={"fly-client-ip": "203.0.113.44"},
    )
    assert r.status_code == 200, r.text
    assert _notes("pin_security") == ["admin changed their PIN, from 203.0.113.44."]


def test_a_cashier_changing_their_pin_is_not_announced(client, make_user):
    uid, _, _ = make_user("baker", "cashier", pin="1234")
    r = client.post(
        "/api/v1/auth/change-pin",
        json={"user_id": uid, "current_pin": "1234", "new_pin": "5678"},
    )
    assert r.status_code == 200, r.text
    assert _notes("pin_security") == []


def test_a_manager_reset_and_new_pin_are_both_announced(client, make_user):
    uid, _, _ = make_user("manny", "manager", pin="123456")
    r = client.post(f"/api/v1/employees/{uid}/reset-pin", headers={"fly-client-ip": "198.51.100.1"})
    assert r.status_code == 200, r.text
    r = client.post(
        "/api/v1/auth/set-pin",
        json={"user_id": uid, "setup_code": r.json()["setup_code"], "pin": "654321"},
        headers={"fly-client-ip": "203.0.113.7"},
    )
    assert r.status_code == 204, r.text
    assert _notes("pin_security") == [
        "admin reset manny's PIN, from 198.51.100.1.",
        "manny set a new PIN with a reset code, from 203.0.113.7.",
    ]


def test_tripping_the_employee_wide_cap_is_announced(client, make_user):
    uid, _, _ = make_user("esti", "cashier", pin="1234")
    ceiling = get_settings().login_max_attempts_per_employee
    for n in range(ceiling - 1):
        _login(client, f"203.0.113.{n // 4}", "0000", user_id=uid)
    assert _notes("login_attack") == []
    _login(client, "192.0.2.1", "0000", user_id=uid)
    [note] = _notes("login_attack")
    assert "esti" in note and "192.0.2.1" in note


def test_a_right_pin_from_one_address_doesnt_reset_the_cap_for_others(client, make_user):
    """19 guesses from strangers, then the real person signs in at the shop:
    before, that wiped the count and the strangers got another 20."""
    uid, _, _ = make_user("esti", "cashier", pin="1234")
    ceiling = get_settings().login_max_attempts_per_employee
    for n in range(ceiling - 1):
        assert _login(client, f"203.0.113.{n // 4}", "0000", user_id=uid).status_code == 401
    assert _login(client, "198.51.100.1", "1234", user_id=uid).status_code == 200
    assert _login(client, "192.0.2.1", "0000", user_id=uid).status_code == 401

    r = _login(client, "192.0.2.2", "1234", user_id=uid)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "account_locked"
    assert _login(client, "198.51.100.1", "1234", user_id=uid).status_code == 200


def test_the_cap_counts_over_a_day_not_forever(client, make_user):
    uid, _, _ = make_user("esti", "cashier", pin="1234")
    ceiling = get_settings().login_max_attempts_per_employee
    for n in range(ceiling - 1):
        _login(client, f"203.0.113.{n // 4}", "0000", user_id=uid)
    with SessionLocal() as db:
        u = db.get(User, uid)
        u.failed_login_window_start = utcnow() - timedelta(hours=25)
        db.commit()
    # Yesterday's typos have aged out, so this is one, not the twentieth.
    assert _login(client, "192.0.2.1", "0000", user_id=uid).status_code == 401
    assert _login(client, "192.0.2.2", "1234", user_id=uid).status_code == 200
    assert _notes("login_attack") == []


def test_a_refused_short_pin_does_not_make_the_address_known(client, make_user):
    """No session was issued, so the address mustn't earn the known-device pass
    on the employee-wide cap."""
    uid, _, _ = make_user("manny", "manager", pin="1234")
    r = _login(client, "192.0.2.9", "1234", user_id=uid)
    assert r.json()["error"]["code"] == "pin_change_required"
    ceiling = get_settings().login_max_attempts_per_employee
    for n in range(ceiling):
        _login(client, f"203.0.113.{n // 4}", "0000", user_id=uid)
    r = _login(client, "192.0.2.9", "1234", user_id=uid)
    assert r.json()["error"]["code"] == "account_locked"
