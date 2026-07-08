# BOS Web Dashboard (React + Vite)

The browser client. Hits the **same FastAPI backend and same PIN login** as the
tablet — no separate backend code, just a second frontend usable from any
laptop/phone/computer.

## Scope

**Full client — parity with the tablet** (owner decision, reversing the spec's
original tablet-only-POS boundary). Every employee can log in (including
first-login PIN setup), take orders, clock in/out, and manage orders, plus all
the oversight screens:

- **Orders** — status board (Pending/In progress/Ready) + Fulfilled; **New order**
  (search-as-you-type, quantities, notes, delivery, payment, Card notes popup,
  idempotent submit); **order detail** (notes checkboxes, status pipeline,
  mark-paid, fulfill, cancel ± reverse stock, print receipt PDF)
- **Clock in / out** — from the sidebar (my weekly hours feed the reports)
- **Reports** — Daily/Monthly cards, payment breakdown, expenses, CSV + PDF
- **Production** — bake list (Today/Tomorrow/Week), CSV
- **Deliveries** — today's manifest, print + CSV
- **Stock** — Ingredients/Products, low/negative, inline +/- and purchase
- **Employees & hours** — all-staff hours; Admin adds/resets PIN/deactivates
- **Tasks** — create + all-staff table, done toggle
- **Notifications** — feed + unread badge + live toasts
- **Admin / Settings** — Products, Ingredients, Recipes builder, Business profile

> **Trade-off:** because order-taking is now reachable from any browser with a
> PIN, the POS is no longer confined to the physical shop devices. That's the
> deliberate choice here; role permissions are still enforced server-side.

## Realtime

Holds the same `/api/v1/ws` WebSocket as the tablets: `orders_changed` /
`stock_changed` invalidate the relevant React Query caches so open pages refresh
live, and `notification` events pop a toast. (No sound — the audible ping is a
shop-floor behaviour; the dashboard is for oversight.) A dropped socket shows a
reconnect banner and auto-retries.

## Running

### One-click (Windows)
Double-click **`bos/start-local.bat`**. It launches the SQLite dev backend
(`:8000`) and the web dashboard (`:5173`) in two windows and opens the browser.
Log in with employee **`system`**, PIN **`1234`** (the dev backend seeds this
admin automatically). Close the two windows to stop.

### Manual
```bash
cd bos/web
npm install
npm run dev               # http://localhost:5173  (reads .env → VITE_API_URL)
npm run build             # typecheck + production build to dist/
```
The backend must be running separately — `python bos/dev_server.py` for the
SQLite dev server on `:8000`.

`VITE_API_URL` (in `.env`, default `http://localhost:8000`) points the dashboard
at the backend. Log in with any Manager/Admin PIN — cashiers can log in but most
screens return 403 by design. First-time PIN setup for new employees happens on
the shop **tablet**, not here.

> Not run in the authoring environment (no Node.js there). `npm install && npm
> run build` (which runs `tsc`) is the first checkout step.

## Layout

```
web/
├─ index.html
├─ src/
│  ├─ main.tsx            # providers: QueryClient, Auth, Realtime, Router
│  ├─ App.tsx             # sidebar shell (layout route + <Outlet/>) + routes
│  ├─ api/                # fetch client, typed endpoints, wire types
│  ├─ auth/               # PIN session (localStorage)
│  ├─ realtime/           # WebSocket → query invalidation + toasts
│  ├─ components/         # PageHead, Tabs, helpers
│  └─ pages/              # one file per screen above
│  └─ styles.css          # single stylesheet, bakery palette (CSS vars)
└─ vite.config.ts
```
