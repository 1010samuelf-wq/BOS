# BOS Tablet App (React Native / Expo)

Phase 4 (passes 1–2): the full tablet app — every §11 screen is now
implemented. Pass 1 delivered the shell, PIN login, realtime wiring, and the
new-order screen; pass 2 added the status board, order detail, stock, hours +
clock-in/out, deliveries, production, tasks, notifications feed, and employees.

## What works now

- **PIN login (§2E)** — roster picker (`GET /auth/roster`) + PIN pad; employees
  without a PIN go through first-login setup (choose + confirm) and straight
  into a session.
- **Side rail shell (§11)** — Orders / Stock / Reports / Employees / Time /
  Tasks / Alerts (with live unread badge), current-user chip with logout.
- **Realtime (§2F/§2H)** — WebSocket to `/api/v1/ws`; `orders_changed` /
  `stock_changed` invalidate React Query caches so open screens refetch;
  notification events show a toast **and play a ping sound**; connection loss
  shows the red "offline — reconnect to continue" banner and **locks
  order/stock actions** until the socket auto-reconnects (3s retry).
- **Orders list** — active vs fulfilled tabs, overdue rows highlighted red.
- **New order screen (§2A/§11)** — client name/phone, needed-for date,
  Pickup/Delivery toggle (delivery price + address reveal), card message,
  search-as-you-type product dropdown, per-line qty (+/- or typed) and notes,
  order-level notes, Pay now (Cash/Card/E-transfer pills — Card opens the
  payment-notes popup) / Pay later, live total, idempotent submit.
- **Order status board** — 3 columns (Pending/In progress/Ready), overdue-red
  cards, note-flag, Fulfilled tab.
- **Order detail** — items, note checkboxes + add-note, status pipeline,
  mark-paid (method), fulfill (delivered/picked up), cancel + reverse-stock,
  read-only when locked on another device.
- **Stock** — Ingredients/Products tabs, low/negative banner, color rows,
  inline +/- and Log purchase.
- **Time** — my hours grid + clock in/out; Admin all-staff totals.
- **Deliveries** — today's manifest with box count.
- **Production** — bake list with Today/Tomorrow/Week presets + totals.
- **Tasks** — own tasks w/ checkboxes; Manager+ create + all-staff table.
- **Notifications feed** — per-type icons, unread emphasis, tap-to-read.
- **Employees (Admin)** — add, reset PIN, deactivate.
- **Print receipt** — order detail fetches the server-rendered PDF and opens the
  tablet's own print/share sheet (expo-print). No server-side printer.

All order math/payload logic is pure TypeScript in `src/order/` — no React —
and covered by the Jest smoke tests in `__tests__/` (spec §10).

## Running

```bash
cd bos/tablet
npm install
npm test          # order-flow smoke tests (no device needed)
npm run android   # Expo dev build on an Android emulator/tablet
```

The API base URL comes from `app.json → expo.extra.apiUrl`. Default is
`http://10.0.2.2:8000` (Android-emulator alias for the host machine running
`dev_server.py`). For a real tablet, set it to the server's LAN/cloud URL.

> Not run in the authoring environment (no Node.js there) — `npm install &&
> npm test` is the first thing to do on checkout.

## Layout

```
tablet/
├─ app/                   # expo-router routes
│  ├─ _layout.tsx         # QueryClient + Auth + Realtime providers
│  ├─ login.tsx           # roster picker + PIN pad + first-PIN setup
│  └─ (main)/             # authed shell: side rail + offline banner + toasts
│     ├─ orders/          # list + new-order screen
│     └─ …                # placeholder rail screens (next pass)
├─ src/
│  ├─ api/                # fetch wrapper, typed endpoints, API types
│  ├─ auth/               # session context (AsyncStorage-backed)
│  ├─ realtime/           # WebSocket provider (invalidate + toast + sound)
│  ├─ order/              # PURE draft logic: money, lines, totals, payload
│  └─ components/         # theme, chrome (banner/toasts), qty control
├─ assets/ping.wav        # notification ping (synthesized)
└─ __tests__/             # Jest smoke tests for the order flow
```
