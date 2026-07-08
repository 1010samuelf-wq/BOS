# Bakery Operations System (BOS) — Backend

FastAPI + PostgreSQL backend for a bakery running on two Android tablets, a web
admin dashboard, and a central server. Server is the single source of truth;
tablets are always-online thin clients (spec §1).

This repository is being built in the phases the spec lays out (§8).
**All phases (1–7) are complete.** Backend (FastAPI/Postgres) with realtime
WebSocket; the full React Native tablet app in [`tablet/`](tablet/) (every §11
screen); the React/Vite web admin dashboard in [`web/`](web/) (the non-POS
companion — no order-taking, no clock-in/out); PDF receipts + report export; and
the go-live testing + monitoring pass (CI, health/liveness probes, request-id
correlation, alertable 5xx logging) — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Backend completeness

Every endpoint in spec §4 now exists, including **`GET /products/search`**
(order-screen typeahead, served by the `pg_trgm` index on Postgres) and
**`/settings/business-profile`** (a singleton `app_settings` row, migration
`0003`). Receipts are exported as PDF and printed from the tablet's own
print/share tool, so there is no server-side printer configuration.

---

## Notifications & Tasks (backend)

- **Notification feed** (spec §2H) — `/notifications` with unread badge count,
  mark-read / read-all, type filter. Aggregates **low/negative stock** (written
  the instant a level crosses its threshold), **overdue orders**, and **overdue
  tasks**.
- **Generation, not just CRUD** — `refresh_overdue` scans for newly-overdue
  orders/tasks and creates one notification each, deduped by related id so a
  given order/task never nags twice. It runs lazily on every feed/badge read and
  can be driven by a scheduler via `POST /notifications/scan`.
- **Real-time hook is in place** — every notification is created through one
  factory (`notifications.create → emit`). Today `emit` logs; **Phase 4 swaps
  its body for a WebSocket broadcast + sound to both tablets (§2F/§2H)** with no
  changes to call sites.
- **Tasks** (spec §2J) — `/tasks` create (Admin/Manager), list (own tasks by
  default; Admin/Manager can query any/all), and `POST /tasks/{id}/done` toggle
  (assignee or Admin/Manager). Overdue tasks carry an `is_overdue` flag for the
  red highlight.

---

## What's in Phase 3 (reports & bookkeeping)

- **Sales / bookkeeping report** (spec §2D) — revenue, order count, ingredient
  cost (COGS from recipes), expenses, and profit for any date range, with a
  Cash / Card / E-transfer / unpaid payment breakdown and the expense list.
  `/reports/daily`, `/reports/monthly`, and custom `/reports/summary?from=&to=`.
- **Expense logging** — `/expenses` CRUD (Manager+).
- **Production summary / bake list** (spec §2D) — per-product quantity needed
  across orders in range (by needed-for date), contributing order count, stock
  on hand, and quantity still to bake; pickup/delivery filter.
- **Delivery manifest** (spec §2A) — delivery orders in range with box count
  (distinct line items, not summed quantity), address, items, total, paid state.
- **All-staff weekly hours** (spec §2G) — Manager+ dashboard across employees.
- **CSV export** for the summary, production, and deliveries reports. (PDF
  export reuses the same aggregation and is folded into the Phase 6 print work.)

Financial reports and expenses are Manager+; the production bake-list and
delivery manifest are operational and open to any authenticated user.

---

## What's in Phase 2 (auth, roles, employees, time)

- **PIN + JWT auth** (spec §2E, §6). Admin creates an employee (name + role);
  the employee sets their own PIN on first login (`POST /auth/set-pin`), then
  `POST /auth/login` issues a short-lived HS256 JWT. PINs are PBKDF2-hashed
  (stdlib, no crypto dependency).
- **Role permissions enforced server-side** on every endpoint. Roles are
  ordered `cashier < manager < admin`: orders = any authenticated user, stock
  adjustments = manager+, catalog/employees = admin.
- **Employee management** (Admin only) — create / edit / list / soft-remove.
- **Clock in / out + weekly hours** — per-employee time entries; a Mon–Sun hours
  grid with weekly total. Own hours by default; Admin can view anyone's.

> **Bootstrap:** the initial migration seeds a `system` admin (id 1) with no
> PIN. First run: `POST /auth/set-pin {"user_id": 1, "pin": "…"}`, then log in.
> Set `BOS_JWT_SECRET` before exposing the server.

---

## What's in Phase 1

- **Full PostgreSQL schema** — every table from spec §5 (models are the source
  of truth; `schema.sql` is a readable mirror; Alembic owns migrations).
- **Core Order API** — create (idempotent), list/filter, get, edit (with
  row-level lock), cancel (± reverse stock), mark-paid, fulfill.
- **Core Inventory API** — live stock, manual adjustment / purchase logging with
  an audit trail, low-stock alerts.
- **Recipe-based, non-blocking stock deduction** inside the order transaction.
- **Supporting catalog CRUD** (products, ingredients, recipes) so orders have
  something to reference.
- Cross-cutting basics: consistent error JSON, pagination, in-process rate
  limiting, structured JSON logging, API versioning, `/health`.
- Tests: 16 unit/integration tests, green on SQLite.

### Deliberately deferred (later phases)
- Real-time WebSocket push + sound for notifications (§2F/§2H) — the hook is
  wired, the transport lands in Phase 4.
- Receipt printing (§2A / Phase 6) and the frontends (Phases 4–5).

---

## Key business rules (as implemented)

- **Stock never blocks a sale.** Deduction always proceeds and levels may go
  negative; crossing a threshold only fires an advisory low-stock notification
  (spec §1, §2B). See `app/services/stock.py`.
- **Dual deduction:** every sale *always* deducts the product's own
  finished-goods stock (`units sold`), and *additionally* deducts the recipe's
  ingredients (`recipe qty × units sold`) when the product has a recipe. A
  product without a recipe therefore only moves its own finished stock. All
  levels may go negative.
- **Idempotency:** each create carries a client UUID. A retried submit with the
  same body returns the original order (`200`); the same key with a *different*
  body is a `409` (spec §4).
- **Row-level edit lock:** opening an order for edit (`POST /orders/{id}/lock`)
  marks it; another user editing meanwhile gets `409 order_locked`. Locks go
  stale after 5 minutes so a crashed tablet can't wedge an order.
- **Cancellation** always requires an explicit call; `reverse_stock` restocks
  exactly what the order deducted (by negating the recorded adjustments, so it
  stays correct even if the recipe changed since). `orders.stock_reversed`
  records which happened, so reports can tell true waste from restocks.
- **Editing** is allowed at any time regardless of paid status; item edits
  re-sync stock (reverse old deltas, deduct the new set).

---

## Running it

### With Docker (Postgres + API + migrations)
```bash
docker compose up --build
# API on http://localhost:8000 , docs at /docs
```

### Locally against your own Postgres
```bash
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
cp .env.example .env            # edit BOS_DATABASE_URL
alembic upgrade head            # create schema + seed the system user
uvicorn app.main:app --reload
```

### Tests (no database needed — runs on in-memory SQLite)
```bash
pip install -r requirements.txt
pytest
```
For true Postgres integration coverage, point `BOS_DATABASE_URL` at a test
database and run `pytest` again — the same suite exercises `FOR UPDATE` locking
and trigram search for real.

---

## Endpoints (v1, prefix `/api/v1`)

All routes except `/health`, `/auth/login`, and `/auth/set-pin` require an
`Authorization: Bearer <jwt>` header.

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/roster` | Pre-login employee picker (unauthenticated, minimal fields) |
| POST | `/auth/set-pin` | First-login PIN setup (unauthenticated) |
| POST | `/auth/login` | PIN login → JWT |
| WS | `/ws?token=<jwt>` | Live events: `orders_changed`, `stock_changed`, `notification` |
| POST/GET/PUT/DELETE | `/employees` | Employee management (Admin) |
| POST | `/employees/{id}/reset-pin` | Reset PIN → first-login state (Admin) |
| POST | `/time/clock-in` · `/time/clock-out` | Clock in/out (self) |
| GET | `/time/hours` | Weekly hours (self; Admin can query any) |
| POST | `/orders` | Create order (idempotency key required) |
| GET | `/orders` | List/filter (status, paid, fulfillment, product name), paginated |
| GET | `/orders/{id}` | Order detail (items + notes) |
| PUT | `/orders/{id}` | Edit (requires/takes the edit lock) |
| POST | `/orders/{id}/lock` · `/release-lock` | Acquire / release edit lock |
| POST | `/orders/{id}/cancel` | Cancel (`reverse_stock: bool`) |
| POST | `/orders/{id}/mark-paid` | Flip unpaid → paid |
| POST | `/orders/{id}/fulfill` | Mark delivered / picked up |
| GET | `/orders/{id}/receipt` | Receipt PDF (client prints via its own tool) |
| GET | `/reports/summary/pdf` | Sales report PDF (Manager+) |
| POST/GET/PUT/DELETE | `/expenses` | Expense logging (Manager+) |
| GET | `/reports/daily` `/reports/monthly` `/reports/summary` | Sales/profit (Manager+) |
| GET | `/reports/summary/export` | Sales report CSV (Manager+) |
| GET | `/reports/production` `/reports/production/export` | Bake list (+CSV) |
| GET | `/reports/hours` | All-staff weekly hours (Manager+) |
| GET | `/deliveries` `/deliveries/export` | Delivery manifest (+CSV) |
| GET/POST | `/notifications` … `/unread-count` `/scan` `/{id}/read` `/read-all` | Feed + badge |
| POST/GET | `/tasks` `/tasks/{id}/done` | Tasks (create Mgr+, own list, toggle) |
| GET | `/stock` | Live levels (filter by type, low-only, name) |
| POST | `/stock/adjust` | Manual adjustment / purchase, audited (Manager+) |
| GET | `/products/search?q=` | Typeahead for the order screen |
| GET/POST/PUT | `/products` `/ingredients` | Catalog CRUD (writes Admin) |
| GET/PUT | `/settings/business-profile` | Receipt/manifest header (write Admin) |
| POST/GET | `/recipes` `/recipes/{product_id}` | Recipe builder (writes Admin) |
| GET | `/health` | Readiness: DB check, 200 healthy / 503 degraded (uptime monitor) |
| GET | `/health/live` | Liveness: process up, no dependency check |

Full request/response schemas are in the live OpenAPI docs at `/docs`.

---

## Layout
```
bos/
├─ app/
│  ├─ main.py                # app factory, middleware, error handlers
│  ├─ config.py  database.py
│  ├─ core/                  # errors, logging, ratelimit, pagination, security, auth
│  ├─ models/                # full schema (spec §5)
│  ├─ schemas/               # Pydantic request/response models
│  ├─ services/              # order + stock business logic
│  └─ api/v1/                # routers
├─ alembic/                  # migrations (0001_initial creates everything)
├─ schema.sql                # readable schema mirror
├─ tests/                    # pytest suite (SQLite)
├─ docker-compose.yml  Dockerfile
└─ requirements.txt  requirements.lock
```

See [`docs/PHASE1.md`](docs/PHASE1.md), [`docs/PHASE2.md`](docs/PHASE2.md),
[`docs/PHASE3.md`](docs/PHASE3.md), and
[`docs/NOTIFICATIONS_TASKS.md`](docs/NOTIFICATIONS_TASKS.md) for design notes and
review checklists.
