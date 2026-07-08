"""Dead-simple in-process rate limiter (spec §4 "basic rate limiting").

Fixed-window per client IP. Good enough for a two-tablet shop on a single
instance; swap for a Redis token-bucket if the app ever scales horizontally.
"""

from __future__ import annotations

import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import get_settings


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._limit = get_settings().rate_limit_per_minute
        self._hits: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        if self._limit <= 0:
            return await call_next(request)

        client = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window_start = now - 60.0
        hits = [t for t in self._hits[client] if t > window_start]
        if len(hits) >= self._limit:
            self._hits[client] = hits
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "rate_limited",
                        "message": "Too many requests, slow down.",
                    }
                },
            )
        hits.append(now)
        self._hits[client] = hits
        return await call_next(request)
