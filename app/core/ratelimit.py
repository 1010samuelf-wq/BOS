"""Dead-simple in-process rate limiter (spec §4 "basic rate limiting").

Fixed-window per client IP. Good enough for a two-tablet shop on a single
instance; swap for a Redis token-bucket if the app ever scales horizontally.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import get_settings
from app.core.errors import APIError


def client_key(request: Request) -> str:
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

        client = client_key(request)
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


class LoginRateLimiter:
    """Stricter per-IP limit for the PIN endpoints: N a minute and M an hour.

    A 4-digit PIN is 10,000 guesses; the general 120/minute limit would let one
    address walk a good share of that in an afternoon. Successful logins are
    refunded, so the whole shop sharing one internet connection never trips it
    by logging in and out all day — only wrong PINs use the budget up.

    In-process, like the middleware: each Fly machine counts on its own, so the
    effective limit is per machine. The per-address lockout in the database is
    the part that holds across machines.
    """

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def hit(self, request: Request) -> str:
        """Count one attempt, or raise 429. Returns the client key so the
        caller can refund it on success."""
        settings = get_settings()
        per_minute, per_hour = settings.login_rate_per_minute, settings.login_rate_per_hour
        client = client_key(request)
        if per_minute <= 0 and per_hour <= 0:
            return client
        now = time.monotonic()
        with self._lock:
            hits = [t for t in self._hits[client] if t > now - 3600.0]
            last_minute = sum(1 for t in hits if t > now - 60.0)
            if (per_minute > 0 and last_minute >= per_minute) or (
                per_hour > 0 and len(hits) >= per_hour
            ):
                self._hits[client] = hits
                raise APIError(
                    429, "rate_limited",
                    "Too many PIN attempts from this connection. Wait a few minutes and try again.",
                )
            hits.append(now)
            self._hits[client] = hits
        return client

    def refund(self, client: str) -> None:
        with self._lock:
            if self._hits[client]:
                self._hits[client].pop()

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


login_limiter = LoginRateLimiter()
