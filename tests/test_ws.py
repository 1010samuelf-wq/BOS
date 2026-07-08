"""WebSocket auth + live notification push (spec §2F/§2H)."""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from tests.conftest import _token_for


def test_ws_rejects_without_token():
    # Using the app as a context manager runs the lifespan (sets the loop).
    with TestClient(app) as c:
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/api/v1/ws"):
                pass


def test_ws_rejects_bad_token():
    with TestClient(app) as c:
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/api/v1/ws?token=not-a-jwt"):
                pass


def test_ws_pushes_low_stock_notification(make_ingredient):
    token = _token_for("admin")
    with TestClient(app) as c:
        auth = {"Authorization": f"Bearer {token}"}
        salt = c.post(
            "/api/v1/ingredients",
            json={"name": "Salt", "unit": "kg", "cost_per_unit": "1", "low_stock_threshold": "3"},
            headers=auth,
        ).json()
        with c.websocket_connect(f"/api/v1/ws?token={token}") as ws:
            # stock above threshold, then drop below → low_stock ping fires
            c.post("/api/v1/stock/adjust", json={
                "item_type": "ingredient", "item_id": salt["id"],
                "delta": "5", "reason": "init"}, headers=auth)
            c.post("/api/v1/stock/adjust", json={
                "item_type": "ingredient", "item_id": salt["id"],
                "delta": "-4", "reason": "use"}, headers=auth)

            # We should receive at least a notification and a stock_changed event.
            seen_types = set()
            for _ in range(5):
                msg = ws.receive_json()
                seen_types.add(msg["type"])
                if "notification" in seen_types:
                    break
            assert "notification" in seen_types
