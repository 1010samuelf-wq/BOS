"""Health probes, request-id correlation, and 5xx handling (spec §10)."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import register_error_handlers
from app.core.logging import RequestLogMiddleware


def test_health_ok_with_version(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["database"] is True
    assert body["version"]  # reported for deploy visibility


def test_liveness_needs_no_db(client):
    r = client.get("/api/v1/health/live")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_cors_allows_web_dashboard_origin(client):
    # The web dashboard (localhost:5173) must be allowed to call the API.
    r = client.get(
        "/api/v1/health", headers={"Origin": "http://localhost:5173"}
    )
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"

    # A preflight for an authed POST is answered (200/204) with the allow headers.
    pre = client.options(
        "/api/v1/orders",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert pre.status_code in (200, 204)
    assert pre.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_request_id_header_present_and_honoured(client):
    # minted when absent
    r = client.get("/api/v1/health")
    assert r.headers.get("x-request-id")

    # an inbound correlation id is echoed back (LB / gateway can set it)
    r = client.get("/api/v1/health", headers={"X-Request-ID": "trace-abc-123"})
    assert r.headers.get("x-request-id") == "trace-abc-123"


def _boom_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestLogMiddleware)
    register_error_handlers(app)

    @app.get("/boom")
    def boom():
        raise RuntimeError("secret internal detail")

    return app


def test_unhandled_error_is_500_with_request_id_and_no_leak():
    client = TestClient(_boom_app(), raise_server_exceptions=False)
    r = client.get("/boom")
    assert r.status_code == 500
    body = r.json()
    assert body["error"]["code"] == "internal_error"
    # request id is stamped in the body so it can be correlated to the logged
    # traceback (the header rides on responses that pass through the middleware;
    # the catch-all 500 is emitted above it, so we assert the body copy here).
    assert body["error"]["request_id"]
    # internal exception text must not leak to the client
    assert "secret internal detail" not in r.text
