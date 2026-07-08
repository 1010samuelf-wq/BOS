"""Real-time broadcast to connected tablets (spec §2F/§2H).

A tiny in-process pub/sub bridging the sync service/route layer to the async
WebSocket connections. `publish` is safe to call from the sync request threads
(FastAPI runs `def` routes in a worker thread); it schedules the async fan-out
onto the main event loop captured at startup.

This is the transport the notification `emit` hook (and order/stock change
events) attach to — the "notifications actively ping both tablets" requirement.
Single-instance only; if the API is ever scaled horizontally, back this with a
Redis pub/sub so events reach clients on every instance.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger("bos.realtime")


class Broadcaster:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._connections: set[Any] = set()  # set[WebSocket]

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def register(self, ws: Any) -> None:
        self._connections.add(ws)

    def unregister(self, ws: Any) -> None:
        self._connections.discard(ws)

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def _fan_out(self, message: dict) -> None:
        dead = []
        for ws in list(self._connections):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections.discard(ws)

    def publish(self, message: dict) -> None:
        """Thread-safe, fire-and-forget. No-op until the loop is set (e.g. in
        unit tests that don't run the app lifespan)."""
        loop = self._loop
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self._fan_out(message), loop)
        except RuntimeError:
            # loop not running (shutdown) — drop the event
            logger.debug("dropped realtime event; loop not running")


# Process-wide singleton.
broadcaster = Broadcaster()
