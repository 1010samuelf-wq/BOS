"""Structured JSON logging + a request/response middleware.

Ships one JSON line per request (method, path, status, duration_ms) plus
whatever the app logs explicitly (stock changes, etc.) — queryable once
pointed at CloudWatch Logs or equivalent (spec §10).
"""

from __future__ import annotations

import logging
import time
import uuid

from pythonjsonlogger import jsonlogger
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import get_settings


def configure_logging() -> None:
    settings = get_settings()
    handler = logging.StreamHandler()
    handler.setFormatter(
        jsonlogger.JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            rename_fields={"asctime": "ts", "levelname": "level"},
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level.upper())


logger = logging.getLogger("bos.request")


class RequestLogMiddleware:
    """Pure-ASGI access log + correlation id (spec §10).

    Writes the request id into ``scope["state"]`` so it's visible to route
    handlers *and* the exception handlers (which build their own Request from
    the same scope — `BaseHTTPMiddleware` doesn't share state as reliably).
    Echoes it as the `X-Request-ID` response header, and keys the log level to
    status so a log-based alert can fire on repeated 5xx (level=ERROR)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        inbound = headers.get(b"x-request-id")
        request_id = inbound.decode() if inbound else str(uuid.uuid4())
        scope.setdefault("state", {})["request_id"] = request_id

        start = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                message.setdefault("headers", []).append(
                    (b"x-request-id", request_id.encode())
                )
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            level = (
                logging.ERROR
                if status_code >= 500
                else logging.WARNING
                if status_code >= 400
                else logging.INFO
            )
            logger.log(
                level,
                "request",
                extra={
                    "request_id": request_id,
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": status_code,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 2),
                },
            )


def request_id_of(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)
