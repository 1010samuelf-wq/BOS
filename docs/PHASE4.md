# Phase 4 — design notes & progress (pass 1)

Covers spec §8 step 4, first pass: **backend realtime layer + tablet app shell,
PIN login, and the new-order screen.** The spec's own note applies: the order
screen is the starting point of this phase, not its whole scope.

## Backend: realtime layer (now live)

1. **Transport** — `WS /api/v1/ws?token=<jwt>` (`app/api/v1/ws.py`), token
   checked *before* accept (close 1008 on failure). Events are JSON:
   `orders_changed`, `stock_changed`, and `notification` (full payload for the
   toast). Clients never need to send anything.
2. **Broadcaster** (`app/core/realtime.py`) — in-process pub/sub; `publish()` is
   sync + thread-safe (routes run in worker threads; fan-out is scheduled onto
   the loop captured by the app lifespan). **No-ops until the lifespan runs**,
   so plain HTTP unit tests are unaffected; WS tests use `with TestClient(app)`.
   Single-instance by design — swap in Redis pub/sub if the API ever scales out.
3. **The `emit` hook is now real** — every notification (low-stock, overdue
   order/task) pushes a live `notification` event; order mutations broadcast
   `orders_changed` (+ `stock_changed` where stock moved); manual stock adjusts
   broadcast `stock_changed`. This fulfills "notifications actively ping" (§2H)
   and "both tablets update live" (§2F).
4. **`GET /auth/roster`** (unauthenticated) — minimal active-employee list
   (id/name/role/pin_set) for the shared-device login picker; `/employees` is
   Admin-only so the login screen couldn't use it. No hashes exposed.
5. **Bug fixed en route:** report/expense/delivery "today" defaults used local
   `date.today()` while data is stored in UTC — off-by-a-day east/west of UTC
   near midnight. All defaults now use `utc_today()` (`app/models/base.py`).

Backend verification: **65/65 pytest green**, including 3 WS tests (reject
no/bad token; live low-stock push received over a real socket connection).

## Tablet app (`bos/tablet/`, Expo + expo-router + TanStack Query)

Built in this pass:
- **Login** — roster picker → PIN pad; `pin_set=false` routes through
  first-login choose/confirm setup (§2E). Session in AsyncStorage (§6 drops the
  local-encryption requirement deliberately).
- **Shell** — §11 side rail with unread-alerts badge; logout chip.
- **Realtime provider** — WS connect w/ 3s auto-reconnect; query invalidation
  per event; notification toast + synthesized ping sound (`assets/ping.wav`);
  offline state renders the red banner and `RequiresConnection` blocks
  order/stock interaction (§1/§2F).
- **Orders list** — active/fulfilled tabs, overdue-red rows.
- **New-order screen** — full §2A flow; all math/payload logic is pure TS in
  `src/order/` (cents-based money, dedup-by-product lines, validation,
  idempotency key fixed per draft so retries can't double-create).
- **Jest smoke tests** (§10) for the core flow: search-add → quantity →
  payload, incl. delivery pricing, pay-later method omission, validation.

**Not executed here:** the authoring environment has no Node.js, so
`npm install && npm test` (and `expo start`) must be run on a dev machine.
The backend contract the app consumes is the part verified end-to-end here.

## Pass 2 — remaining screens (done)

Backend addition: **order-note endpoints** — `POST /orders/{id}/notes` (add) and
`POST /orders/{id}/notes/{note_id}/done` (toggle, records who+when). These were
missing; the detail screen's note checkboxes (§2A) need them. Verified live and
by a new test (`test_add_note_and_toggle_done`). Backend now **66/66 green, 48
endpoints**.

Tablet screens built this pass:
- **Order status board** — 3 columns (Pending/In progress/Ready), overdue-red
  cards, unresolved-note flag, tap → detail; Fulfilled tab.
- **Order detail** — items, notes with done checkboxes + add-note, status
  pipeline moves, read-only notice when locked elsewhere, Mark-as-paid (method
  picker), Mark delivered/picked up, Cancel dialog with the Reverse-Stock toggle.
- **Stock** — Ingredients/Products tabs, search, low/negative banner,
  color-coded rows (green/amber/red), inline +/- adjust, Log-purchase modal.
- **Time** — my Mon–Sun hours grid + weekly total, clock in/out button; Admin
  sees an all-staff totals table.
- **Deliveries** — today's manifest table with box count (distinct lines).
- **Production** — bake list with Today/Tomorrow/This-week presets, needed /
  orders / in-stock / to-bake columns + totals row.
- **Tasks** — my tasks w/ checkboxes; Manager+ create form (roster-based
  assignee) + all-staff table, overdue red.
- **Notifications feed** — icons per type, unread emphasis, tap-to-read +
  jump-to-order, mark-all-read.
- **Employees (Admin)** — add employee (name+role), reset PIN, deactivate.
- Rail expanded to 9 items (scrollable) incl. Bake list + Deliveries.

## Still open (small)

- Date/time picker polish on "needed for" (currently a text field).
- CSV export/print buttons on Deliveries/Production (deferred to the web
  dashboard, Phase 5, where file download is natural).
- Device smoke-run on an actual Android tablet + `npm test`/`tsc` (needs Node —
  not available in the authoring environment).
