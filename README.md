# Just Cake — Bakery Operations System

A complete operations platform for a working bakery: order taking and
fulfillment, a tablet point-of-sale, an admin web dashboard, a public ordering
site, and the reporting a bakery actually needs to run its business — recipe
costing, production planning, payroll hours, and a simple accounts
payable/receivable ledger.

The backend is the single source of truth; every client (tablet, dashboard,
public site) is a thin, always-online consumer of the same API.

## Live

| | |
|---|---|
| Admin dashboard | [app.justcakeskosher.com](https://app.justcakeskosher.com) |
| Public ordering site | [justcakeskosher.com](https://justcakeskosher.com) |
| API | `just-cake-bakery.fly.dev` — interactive docs at `/docs` |

## Features

**Orders** — search-as-you-type and browse-by-category product entry, custom
(not-in-catalog) line items, delivery vs. pickup, idempotent submission, a
row-level edit lock so two devices can't overwrite each other's changes, and
PDF receipts.

**Catalog & recipes** — products with photos and staff-editable categories,
ingredients, and recipes that drive per-unit ingredient cost automatically.

**Inventory** — every sale deducts finished-goods stock and, for recipe-backed
products, the underlying ingredients too. Levels can go negative rather than
block a sale; low-stock crossings raise a notification.

**Reports & bookkeeping** — daily/monthly/custom-range sales and profit
(cash-basis: only paid orders and paid-out shifts count), a production
"what to bake" summary, a driver-facing delivery manifest PDF, and an accounts
payable/receivable ledger for tracking what the business owes suppliers and is
owed by others.

**Staff** — PIN + JWT auth with per-employee section permissions, clock in/out
with weekly hours, and assignable tasks.

**Tablet app** — a native Android POS (Expo/React Native) with offline-aware
UI, live updates over WebSocket, and over-the-air JS updates.

## Stack

| | |
|---|---|
| Backend | FastAPI, PostgreSQL, SQLAlchemy, Alembic |
| Web dashboard | React, Vite, TypeScript |
| Tablet app | Expo / React Native |
| Public menu site | React, Vite |
| Deploys | Fly.io, via GitHub Actions |

## Repository layout

```
app/          FastAPI backend — models, schemas, services, API routers
alembic/      Database migrations
tests/        Backend test suite (pytest)
web/          Admin dashboard (React)
tablet/       Tablet POS app (Expo / React Native)
menu/         Public ordering site (React)
docs/         Design notes and the original build spec
```

## Getting started

### Backend

Run from the repository root:

```bash
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
cp .env.example .env            # set BOS_DATABASE_URL
alembic upgrade head            # creates the schema and seeds the admin user
uvicorn app.main:app --reload   # API on http://localhost:8000, docs at /docs
```

Or with Docker (Postgres + API + migrations in one step):

```bash
docker compose up --build
```

### Web dashboard

```bash
cd web
npm install
npm run dev
```

### Tablet app

```bash
cd tablet
npm install
npx expo start
```

### Tests

```bash
pytest              # backend — runs on in-memory SQLite, no database needed
cd tablet && npm test
```

## Deployment

Each app deploys independently to Fly.io via the `Deploy` GitHub Actions
workflow (manual dispatch, gated on the backend test suite passing). See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the operational details —
health checks, migrations-before-cutover, and monitoring.

## Further reading

[`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) covers the role/section
permission model; [`docs/SPEC.md`](docs/SPEC.md) is the original product spec
this system was built against.
