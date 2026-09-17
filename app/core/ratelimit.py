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


def _client_key(request: Request) -> str:
    """Who to count this request against.

    `request.client.host` is the *proxy's* address in production, not the
    caller's: Fly terminates the connection and forwards it from an internal
    address. Using it meant the entire shop plus every visitor to the public
    menu shared about two buckets, so a busy morning on the website could hand
    429s to staff mid-order.

    Fly sets `Fly-Client-IP` to the real peer, so that is preferred.
    `X-Forwarded-For` is the fallback; its first entry is the original client
    and the rest are proxies. Both headers are only trustworthy because nothing
    reaches this app except through Fly's proxy, which overwrites them — a
    client-supplied value would otherwise let anyone pick their own bucket.
    """
    fly_ip = request.headers.get("fly-client-ip")
    if fly_ip:
        return fly_ip.strip()

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first

    # Local dev and tests, where there is no proxy in front.
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._limit = get_settings().rate_limit_per_minute
        self._hits: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        if self._limit <= 0:
            return await call_next(request)

        client = _client_key(request)
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
