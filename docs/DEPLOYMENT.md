# Deployment & Monitoring

Operational guide for the BOS backend (spec §6, §7, §10). The tablets and web
dashboard are useless if the server is unreachable, so uptime + alerting are
first-class, not optional.

## 1. Deploy

The stack is provider-agnostic (Docker + Postgres). Any of AWS / DigitalOcean /
GCP works; pick at deploy time (spec §7).

### Docker (simplest)
```bash
cd bos
docker compose up --build     # Postgres + API + migrations, API on :8000
```

### Manual
```bash
pip install -r requirements.txt
export BOS_DATABASE_URL=postgresql+psycopg://USER:PASS@HOST:5432/bos
export BOS_JWT_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Required config (see `.env.example`)
- **`BOS_DATABASE_URL`** — Postgres DSN.
- **`BOS_JWT_SECRET`** — **must** be a strong, ≥32-byte value. The dev default is
  intentionally insecure.
- `BOS_RATE_LIMIT_PER_MINUTE`, `BOS_JWT_EXPIRE_MINUTES`, `BOS_LOG_LEVEL` — tune as
  needed.

### Hardening (spec §6)
- **HTTPS only.** Terminate TLS at a reverse proxy (nginx/Caddy/ALB) in front of
  uvicorn. Tablets connect over the internet, so a public/VPN-reachable address
  with a valid cert is required (§7).
- Lock the security group to the proxy; don't expose Postgres publicly.
- **Daily encrypted DB backups.** e.g. a cron running
  `pg_dump ... | gpg --encrypt ...` to object storage, or the managed DB's
  automated encrypted snapshots. Test a restore.
- Set `X-Request-ID` pass-through on the proxy so client-facing request ids match
  the app logs.

## 2. Health checks

| Endpoint | Use | Behaviour |
|---|---|---|
| `GET /api/v1/health` | **Uptime monitor / readiness** | Checks the DB; returns **200** healthy, **503** when the DB is unreachable, with `{status, database, version}`. |
| `GET /api/v1/health/live` | **Liveness** (orchestrator) | Always 200 if the process serves; no DB dependency, so a transient DB blip won't get a healthy process killed. |

Point an uptime monitor (CloudWatch Synthetics, UptimeRobot, Pingdom, …) at
`/api/v1/health` and **alert on any non-200 or on no-response** — that covers both
server-down and DB-down.

## 3. Logging

Structured JSON to stdout (one object per line) — ship stdout to CloudWatch Logs
/ Loki / Datadog. Key fields:
- Access log (`bos.request`): `request_id`, `method`, `path`, `status`,
  `duration_ms`. **Log level is keyed to status**: 2xx/3xx = INFO, 4xx = WARNING,
  5xx = ERROR.
- Unhandled 5xx (`bos.error` / `unhandled_error`): full traceback + `request_id`.
  The client only ever gets a generic message + the `request_id` to quote.
- Domain events: `stock_change`, `low_stock_alert`, `notification`.

Every request carries an `X-Request-ID` (minted, or an inbound one honoured), also
returned to the client — the thread to pull when correlating a report to logs.

## 4. Alerting (spec §10)

Set these from the shipped logs/metrics:
- **Server down** — uptime monitor on `/health` fails N consecutive checks.
- **Repeated 5xx** — metric filter on access-log lines with `status >= 500`
  (they're `level=ERROR`); alarm on rate over a window (e.g. > 5 in 5 min). Each
  is backed by an `unhandled_error` traceback line sharing the `request_id`.
- **DB degraded** — `/health` returning 503 (a subset of the downtime alarm).

## 5. Testing before go-live (spec §10)

- **Unit + integration**: the full suite passes — run `pytest` to see the
  current count. It runs on stdlib SQLite by default; set `BOS_DATABASE_URL` to a
  Postgres test DB to run the **same suite as true integration** (FOR UPDATE
  locking, real transactions):
  ```bash
  BOS_DATABASE_URL=postgresql+psycopg://bos:bos@localhost:5432/bos_test pytest
  ```
- **Tablet smoke test**: `cd tablet && npm test` — the core order flow
  (search-add → quantity → submit payload).
- **CI** (`.github/workflows/ci.yml`) runs all three on every push: backend
  against a Postgres service (+ `alembic upgrade head` to validate migrations),
  tablet `tsc` + Jest, web `tsc` + build.

## 6. Building the client apps (tablet & web)

Both clients install with `npm install`. The **web** dashboard installs cleanly
and is verified end-to-end. The **tablet** (Expo) app has **not yet been
compiled or run** — its install is blocked in the current environment (see
below). Treat the tablet code as unverified until a clean install + `tsc` +
`npm test` + a real device/emulator run have all passed.

### ⚠️ Known blocker: content filter breaks `npm install` for the tablet
On the current build machine a **Geder content filter** intermittently returns
an HTML block page (instead of JSON) for individual npm registry requests. The
web tree (~76 packages) happens to clear, but the tablet's larger Expo
dependency tree reliably trips it on a transitive package:

```
npm error code FETCH_ERROR
npm error invalid json response body at
  https://registry.npmjs.org/@0no-co%2fgraphql.web
  reason: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

Diagnosis: a direct browser-style HTTPS GET of that exact package URL returns
valid JSON (HTTP 200), while npm gets the block page — i.e. the filter is keyed
on npm's request signature (User-Agent), not a registry outage or an unpublished
package. **Do not spoof npm's User-Agent to get around it** — that's
circumventing a network security control and is out of bounds. Fix the
environment instead:

1. **Whitelist `registry.npmjs.org` (whole domain) in Geder** — the real fix;
   lets the entire tablet app install/typecheck/run. Geder contact on file:
   **718-384-3337**.
2. Or run `cd tablet && npm install` **once on a network without the filter**
   (or a phone hotspot), commit the resulting `package-lock.json`, and restore
   `node_modules` from that trusted install.

Until one of those is done, the tablet cannot be built or verified here, and any
tablet-side feature work (e.g. bringing it to parity with the web client's
Orders filter bar, Reports drill-down, product photos, ingredient deactivate,
and Tasks filters) is deliberately **on hold** rather than written blind.

### Once install succeeds
```bash
cd tablet
npm install              # must complete without FETCH_ERROR
npx tsc --noEmit         # typecheck
npm test                 # Jest order-flow smoke test
npx expo start --android # run on the two shop tablets
```

## 7. Scaling note

Realtime (`/ws`) and the in-process rate limiter / low-stock de-dup are
**single-instance**. For >1 API replica, back the broadcaster with Redis pub/sub
and move rate limiting to a shared store. A two-tablet shop does not need this.
