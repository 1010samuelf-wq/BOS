# Phase 7 — testing + monitoring pass (design notes & review)

The final go-live pass (spec §8 step 7, §10). Most groundwork already existed
(`/health`, structured JSON logging, 70 tests); this phase makes the server
**operable and alertable in production** and wires CI.

## What changed

1. **Health semantics fixed.** `GET /health` now returns **503** when the DB is
   unreachable (was a misleading 200 with `status: "degraded"`), so an
   HTTP-status uptime monitor actually alerts. Added `version` to the body and a
   separate **`GET /health/live`** pure-liveness probe (no DB) so a transient DB
   blip can't get a healthy process killed by an orchestrator.

2. **5xx are no longer silent.** The catch-all exception handler now logs the
   **full traceback** (`bos.error` / `unhandled_error`) with the request id, and
   returns the request id to the client (generic message only — no internal
   leak). Before this, unhandled errors vanished — undebuggable and unalertable.

3. **Request correlation.** The access-log middleware was rewritten from
   `BaseHTTPMiddleware` to a **pure-ASGI middleware** — it writes the request id
   into `scope["state"]` so it's reliably visible to both route and exception
   handlers (BaseHTTPMiddleware doesn't share state dependably), echoes it as the
   `X-Request-ID` response header, honours an inbound id from a proxy, and keys
   log **level to status** (2xx=INFO, 4xx=WARNING, 5xx=ERROR) so a log-based
   alert can fire on repeated 5xx.

4. **Integration against real Postgres.** The suite already respects
   `BOS_DATABASE_URL` (conftest uses `setdefault`), so pointing it at Postgres
   runs the *same* tests as true integration (FOR UPDATE, real transactions).
   Documented + wired into CI.

5. **CI** (`.github/workflows/ci.yml`): backend tests on a Postgres service
   (plus `alembic upgrade head` to validate migrations apply), tablet `tsc` +
   Jest smoke tests, web `tsc` + build — on every push.

6. **`docs/DEPLOYMENT.md`**: deploy (Docker/manual), config, HTTPS + encrypted
   backups (§6), health-check table, log shipping, the three alert rules
   (server down / repeated 5xx / DB degraded), and the scaling caveat.

## Verified

- `pytest` — **74/74 green** (4 new: health+version, liveness, request-id
  present/honoured, unhandled-500 shape with request id + no exception leak).
- **Live against the running server**: `/health` 200 `{status, database,
  version}` with `X-Request-ID`; `/health/live` 200; inbound `X-Request-ID`
  echoed back.

## Not run here

The CI workflow and the Postgres integration run need a CI runner / a Postgres
instance (no Node.js or Postgres in the authoring environment). They're standard
and reviewed; the app-side behaviour they exercise is verified on SQLite + live.

## Status: build complete

All seven phases of the spec's build order are done. Remaining work is genuine
deployment (pick a cloud provider, provision Postgres + TLS, set secrets) and
running the frontends' `npm install && test/build` on a dev machine.
