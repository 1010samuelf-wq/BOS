"""Retiring sessions before their token expires.

A JWT here lasts 12 hours by default, so without this a shared tablet that
walks out of the shop stays signed in for the rest of the day. Bumping the
user's `token_version` retires every token minted before it.
"""

from app.core.security import create_access_token
from tests.conftest import _client_with_token


def _login(client, user_id: int, pin: str):
    return client.post("/api/v1/auth/login", json={"user_id": user_id, "pin": pin})


def test_a_normal_session_keeps_working(make_user):
    """Guard against the check rejecting everything — this must pass for the
    other tests here to mean anything."""
    _, _, authed = make_user("Steady Sam", "manager")
    assert authed.get("/api/v1/orders").status_code == 200


def test_resetting_a_pin_kills_that_employees_existing_sessions(client, make_user):
    """The lost-tablet remedy: an admin resets the PIN and the session on the
    missing device stops working immediately, not in twelve hours."""
    uid, _, victim = make_user("Lost Tablet Lou", "manager")
    assert victim.get("/api/v1/orders").status_code == 200

    assert client.post(f"/api/v1/employees/{uid}/reset-pin").status_code == 200

    r = victim.get("/api/v1/orders")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "token_revoked"


def test_setting_a_new_pin_kills_sessions_opened_under_the_old_one(client, make_user):
    uid, _, old_session = make_user("Rotating Rita", "manager")
    setup_code = client.post(f"/api/v1/employees/{uid}/reset-pin").json()["setup_code"]

    # The reset already retired that session; setting the new PIN keeps it dead.
    assert client.post("/api/v1/auth/set-pin", json={
        "user_id": uid, "pin": "778899", "setup_code": setup_code,
    }).status_code == 204

    assert old_session.get("/api/v1/orders").status_code == 401


def test_a_fresh_login_after_a_reset_works(client, make_user):
    """Revocation must not lock the employee out of their own account."""
    uid, _, _ = make_user("Back In Bella", "manager")
    setup_code = client.post(f"/api/v1/employees/{uid}/reset-pin").json()["setup_code"]
    client.post("/api/v1/auth/set-pin", json={
        "user_id": uid, "pin": "445566", "setup_code": setup_code,
    })

    out = _login(client, uid, "445566")
    assert out.status_code == 200
    fresh = _client_with_token(out.json()["access_token"])
    assert fresh.get("/api/v1/orders").status_code == 200


def test_sign_out_everywhere_ends_every_device(make_user):
    uid, token, phone = make_user("Two Devices Dov", "manager")
    tablet = _client_with_token(token)  # same token, second client
    assert tablet.get("/api/v1/orders").status_code == 200

    assert phone.post("/api/v1/auth/sign-out-everywhere").status_code == 204

    assert tablet.get("/api/v1/orders").status_code == 401
    assert phone.get("/api/v1/orders").status_code == 401


def test_sign_out_everywhere_needs_authentication(anon_client):
    assert anon_client.post("/api/v1/auth/sign-out-everywhere").status_code == 401


def test_one_employees_reset_does_not_touch_another(client, make_user):
    uid_a, _, alice = make_user("Alice A", "manager")
    _, _, bob = make_user("Bob B", "manager")

    client.post(f"/api/v1/employees/{uid_a}/reset-pin")

    assert alice.get("/api/v1/orders").status_code == 401
    assert bob.get("/api/v1/orders").status_code == 200


def test_tokens_minted_before_this_field_existed_still_work(make_user):
    """Deploying this must not sign the whole shop out at once: an older token
    carries no version claim, and absent is treated as the column default."""
    uid, _, _ = make_user("Legacy Len", "manager")

    import jwt as pyjwt

    from app.config import get_settings
    from app.models.base import utcnow

    settings = get_settings()
    from datetime import timedelta

    legacy = pyjwt.encode(
        {
            "sub": str(uid),
            "role": "manager",
            "iat": utcnow(),
            "exp": utcnow() + timedelta(minutes=60),
            # note: no "tv" claim at all
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    assert _client_with_token(legacy).get("/api/v1/orders").status_code == 200


def test_a_stale_version_is_rejected_even_if_otherwise_valid(make_user):
    """Belt and braces: a correctly signed, unexpired token whose version has
    moved on is refused."""
    uid, _, _ = make_user("Stale Stan", "manager")
    stale = create_access_token(uid, "manager", token_version=99)

    r = _client_with_token(stale).get("/api/v1/orders")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "token_revoked"
