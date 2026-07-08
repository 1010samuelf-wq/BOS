"""WebSocket endpoint for live updates + notification pings (spec §2F/§2H).

Clients connect to `/api/v1/ws?token=<jwt>`. The server pushes JSON events:
  - {"type": "notification", "notification": {...}}  ← low-stock / overdue pings
  - {"type": "orders_changed"}                        ← refresh order lists
  - {"type": "stock_changed"}                         ← refresh stock views

The client keeps the socket open and refetches (or toasts) on each event. No
client→server messages are required; anything received is ignored (keepalive).
"""

from __future__ import annotations

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.realtime import broadcaster
from app.core.security import decode_access_token

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str | None = None) -> None:
    # Authenticate before accepting (query-param token — WS can't send headers
    # from all clients). Close with policy-violation on any failure.
    if not token:
        await websocket.close(code=1008)
        return
    try:
        decode_access_token(token)
    except jwt.PyJWTError:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    broadcaster.register(websocket)
    try:
        while True:
            # We don't need client messages; this just detects disconnect.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.unregister(websocket)
