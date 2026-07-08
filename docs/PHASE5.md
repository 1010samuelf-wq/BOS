# Phase 5 — web admin dashboard (design notes & review)

Covers spec §8 step 5: a browser companion (React + Vite + TanStack Query +
React Router) that **reuses the exact same API** — no backend changes at all.

## Decisions

1. **Scope = the tablet's non-POS screens, nothing more.** Reports, Production,
   Deliveries, Stock, Employees & hours, Tasks, Notifications, Admin/Settings.
   **Order-taking and clock-in/out are deliberately absent** (spec §1 — both are
   physical shop-floor actions and stay tablet-only). The dashboard has no
   Orders board and no clock button; the order-management endpoints were removed
   from the web API layer to keep the boundary clean.

2. **Admin/Settings is new surface** (the tablet skipped it): Products,
   Ingredients, a Recipes builder (pick product → add ingredient+qty rows →
   `POST /recipes`), and Business profile — all backed by endpoints that already
   existed. (No printer config: receipts are exported as PDF and printed from
   the tablet's own print/share tool, so the server never targets a printer.)

3. **Same PIN login, same JWT, same WebSocket.** Session in localStorage; the
   realtime provider invalidates React Query caches on `orders_changed` /
   `stock_changed` and toasts on `notification` (no sound — oversight tool).

4. **Authenticated CSV export.** Export endpoints require a bearer token, so a
   bare `<a href>` would 401. `downloadCsv` fetches with the header and triggers
   a Blob download instead. Deliveries also offers browser Print.

5. **Role behaviour is server-driven.** The sidebar shows every screen; the
   backend returns 403 for under-privileged roles and the page renders a plain
   "requires Manager/Admin access" message. No client-side role gating to drift
   out of sync with the server.

## Not run here

No Node.js in the authoring environment, so the app is **written but not
compiled/run** — `npm install && npm run build` (runs `tsc`) on a dev box is the
first step. Reviewed statically for the usual traps: no `React.*` namespace refs
without import, layout-route + `<Outlet/>` instead of fragile nested `<Routes>`,
and typed endpoints matching the verified backend contract.

## Backend impact

**Zero.** Phase 5 added no endpoints and no migrations — the whole point of
"same API serves both clients". Backend remains 66/66 green, 48 endpoints.

## Suggested review focus

- `src/App.tsx` — routing/layout and the non-POS nav scope.
- `src/pages/Settings.tsx` — the recipe builder (only genuinely new UI logic).
- `src/api/endpoints.ts` — confirm nothing order-taking / clock-in leaked in.
