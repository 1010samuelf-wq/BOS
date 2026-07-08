"""Consistent error shape across the whole API (spec §4).

Every error response is ``{"error": {"code": ..., "message": ...}}`` so the
clients can handle failures generically instead of per-endpoint.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_of

logger = logging.getLogger("bos.error")


class APIError(Exception):
    """Raise from services/routes to return a structured error response."""

    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


# Convenience constructors for the cases Phase 1 actually uses.
def not_found(message: str, code: str = "not_found") -> APIError:
    return APIError(status.HTTP_404_NOT_FOUND, code, message)


def bad_request(message: str, code: str = "validation_error") -> APIError:
    return APIError(status.HTTP_400_BAD_REQUEST, code, message)


def conflict(message: str, code: str = "conflict") -> APIError:
    return APIError(status.HTTP_409_CONFLICT, code, message)


def _body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def _handle_api_error(_: Request, exc: APIError):
        return JSONResponse(
            status_code=exc.status_code, content=_body(exc.code, exc.message)
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_validation(_: Request, exc: RequestValidationError):
        # Flatten pydantic/FastAPI validation detail into one message.
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        msg = first.get("msg", "Invalid request")
        message = f"{loc}: {msg}" if loc else msg
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=_body("validation_error", message),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http(_: Request, exc: StarletteHTTPException):
        code = {
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            409: "conflict",
        }.get(exc.status_code, "http_error")
        message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return JSONResponse(
            status_code=exc.status_code, content=_body(code, message)
        )

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception):
        # Never swallow a 5xx: log the full traceback with the correlation id so
        # the failure is debuggable and alertable (spec §10). The client gets a
        # generic message plus the id to quote to support.
        rid = request_id_of(request)
        logger.exception(
            "unhandled_error",
            extra={"request_id": rid, "path": request.url.path},
        )
        body = _body("internal_error", "An unexpected error occurred.")
        if rid:
            body["error"]["request_id"] = rid
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content=body
        )
