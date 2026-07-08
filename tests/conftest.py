"""Test harness.

Runs against in-memory SQLite so the suite executes anywhere with no Postgres.
The app code is Postgres-first (FOR UPDATE locks, pg_trgm) but degrades cleanly
on SQLite: lock hints are ignored and the trigram index lives only in the
migration, not the ORM. For true integration coverage against Postgres, point
BOS_DATABASE_URL at a test database and run the same suite (spec §10).
"""

import os

# Must be set before any app module imports settings.
os.environ.setdefault("BOS_DATABASE_URL", "sqlite://")
os.environ.setdefault("BOS_RATE_LIMIT_PER_MINUTE", "0")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import create_access_token, hash_pin
from app.database import SessionLocal, engine
from app.main import app
from app.models import Base, User, UserRole
from app.models.base import utcnow

ADMIN_PIN = "4242"


def _seed_admin() -> None:
    """Seed a ready-to-use admin (PIN already set). Most tests act as admin via
    the default `client`; role-specific tests mint their own users."""
    with SessionLocal() as db:
        db.add(
            User(
                name="admin",
                role=UserRole.admin,
                pin_hash=hash_pin(ADMIN_PIN),
                pin_set=True,
                active=True,
            )
        )
        db.commit()


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    _seed_admin()
    yield
    Base.metadata.drop_all(engine)


def _token_for(name: str) -> str:
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.name == name))
        return create_access_token(u.id, u.role.value)


def _client_with_token(token: str | None) -> TestClient:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return TestClient(app, headers=headers)


@pytest.fixture
def client() -> TestClient:
    """Authenticated as the seeded admin — passes every role check."""
    return _client_with_token(_token_for("admin"))


@pytest.fixture
def anon_client() -> TestClient:
    """No Authorization header — for testing auth is enforced."""
    return _client_with_token(None)


@pytest.fixture
def make_user():
    """Create an employee with a set PIN; return (id, token, client)."""

    def _make(name: str, role: str = "cashier", pin: str = "1111"):
        with SessionLocal() as db:
            u = User(
                name=name,
                role=UserRole(role),
                pin_hash=hash_pin(pin),
                pin_set=True,
                active=True,
            )
            db.add(u)
            db.commit()
            db.refresh(u)
            uid, urole = u.id, u.role.value
        token = create_access_token(uid, urole)
        return uid, token, _client_with_token(token)

    return _make


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


# ---- small builders reused across tests ------------------------------------
@pytest.fixture
def make_product(client):
    def _make(name="Croissant", price="3.50", active=True):
        r = client.post(
            "/api/v1/products",
            json={"name": name, "price": price, "active": active},
        )
        assert r.status_code == 201, r.text
        return r.json()

    return _make


@pytest.fixture
def make_ingredient(client):
    def _make(name="Flour", unit="kg", cost="1.20", threshold="2"):
        r = client.post(
            "/api/v1/ingredients",
            json={
                "name": name,
                "unit": unit,
                "cost_per_unit": cost,
                "low_stock_threshold": threshold,
            },
        )
        assert r.status_code == 201, r.text
        return r.json()

    return _make


def order_payload(product_id, key, **overrides):
    payload = {
        "idempotency_key": key,
        "client_name": "Jane Doe",
        "client_phone": "555-1234",
        "fulfillment_type": "pickup",
        "payment_timing": "now",
        "payment_method": "cash",
        "items": [{"product_id": product_id, "quantity": 2}],
    }
    payload.update(overrides)
    return payload
