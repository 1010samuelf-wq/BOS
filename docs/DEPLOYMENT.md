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

Set `BOS_ENV=production` (or `BOS_ENV=prod`) in the deployed environment. The API now fails fast unless production uses a unique JWT secret of at least 32 bytes, PostgreSQL, and non-local CORS origins.
- **`BOS_DATABASE_URL`** — Postgres DSN.
- **`BOS_JWT_SECRET`** — **must** be a strong, ≥32-byte value. The dev default is
  intentionally insecure.
- `BOS_RATE_LIMIT_PER_MINUTE`, `BOS_JWT_EXPIRE_MINUTES`, `BOS_LOG_LEVEL` — tune as
  needed.
- **`BOS_CORS_ORIGINS`** — comma-separated HTTPS dashboard origins in production.

### Preflight checklist

```bash
alembic upgrade head
.venv/Scripts/python.exe -m pytest
cd tablet && npx tsc --noEmit && npm test -- --runInBand
cd ../web && npm run typecheck && npm run build
```

Before release, verify `/api/v1/health` from the deployed URL, exercise login and
one order create/edit/replay path, and confirm the tablet's offline queue and Sync
Review screen on a real Android device.

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
  current count (230 at the time of writing). It runs on stdlib SQLite by default; set `BOS_DATABASE_URL` to a
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

Both clients install with `npm install`. Both are verified end to end: `tsc`,
the Jest/unit suites, and — for the tablet — a real EAS build.

> **This section used to say the tablet could not be installed or compiled**,
> describing a content-filter blocker on `registry.npmjs.org`. That blocker is
> long gone; the claim survived far longer than the problem and misled at least
> one review into concluding the tablet was unbuildable. It isn't.

### Web dashboard

```bash
cd web
npm install
npx tsc --noEmit
VITE_API_URL=https://just-cake-bakery.fly.dev npm run build   # see §1 landmine
```

### Tablet

```bash
cd tablet
npm install
npx tsc --noEmit
npx jest
```

**Shipping a tablet change — pick the right one:**

| Change | How | Why |
|---|---|---|
| JS/TS only | `npx eas-cli update --branch production --platform android -m "..."` | Over-the-air; devices pick it up on next launch |
| Adds or upgrades a native module | `npx eas-cli build --platform android --profile production` | An OTA **cannot** add native code — the app would crash on launch |

Read the OTA landmine in `CLAUDE.md` before publishing an update: `eas update`
bundles the whole working directory, so unfinished work importing a native
module the installed binary lacks will crash the tablets.

A build produces a signed APK to sideload onto the shop tablets. Bump both
`version` and `android.versionCode` in `tablet/app.json` first — `versionCode`
so Android treats it as an upgrade, and `version` because `runtimeVersion` is
`appVersion`, which keeps an older OTA channel from serving stale JS to the new
install.

## 7. Scaling note

Realtime (`/ws`) and the in-process rate limiter / low-stock de-dup are
**single-instance**. For >1 API replica, back the broadcaster with Redis pub/sub
and move rate limiting to a shared store. A two-tablet shop does not need this.
