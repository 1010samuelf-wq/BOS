"""The ASGI wrapper that accepts absolute-form (proxy) request targets.

A tablet behind a content-filter proxy sends `GET http://host:port/path` instead
of `GET /path`; without normalisation the app 404s on the literal URL.
"""

import asyncio

from app.main import ProxyFormPathNormalizer


def _run_with_path(path: str) -> str:
    seen: dict[str, str] = {}

    async def inner(scope, receive, send):
        seen["path"] = scope["path"]

    mw = ProxyFormPathNormalizer(inner)
    scope = {"type": "http", "path": path, "raw_path": path.encode("latin-1")}
    asyncio.run(mw(scope, None, None))
    return seen["path"]


def test_absolute_form_target_is_stripped_to_origin_path():
    assert _run_with_path("http://192.168.2.10:8000/api/v1/time/clock-in") == "/api/v1/time/clock-in"
    assert _run_with_path("https://just-cake-bakery.fly.dev/api/v1/orders") == "/api/v1/orders"


def test_origin_form_path_is_untouched():
    assert _run_with_path("/api/v1/health") == "/api/v1/health"
