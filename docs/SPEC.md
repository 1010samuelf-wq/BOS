# Bakery Operations System (BOS) — Technical Specification

> **Canonical in-repo copy.** Kept in sync with the build. Reconciled with the
> as-built system on 2026-07-07 — see the change note in §7 (Web dashboard scope).

**Purpose:** A bakery management platform running on two Android tablets and a central server, handling order taking, inventory tracking, bookkeeping, and reporting. Tablets are **always-online, thin clients** — no offline mode, no local write queue, no conflict resolution needed, since the server is the single source of truth at all times.

---

## 1. System Overview

- **Two Android tablet apps** — React Native, always connected to the server over local network or internet. If connectivity drops, the app shows a clear "offline — reconnect to continue" state and blocks order/stock actions until connection is restored. No local queue, no background sync. **This is the full app** — every screen designed in §11 (orders, status board, stock, employee hours + clock-in/out, deliveries, production summary, tasks, notifications, admin/settings) lives here, since this is what staff use all day on the shop floor. It is not just an order-entry screen.
- **Web dashboard** — a browser-based client (any laptop/phone/computer, not just the two shop tablets), hitting the same FastAPI backend and same PIN login as the tablets. It is a **full client at parity with the tablet**: every §11 screen, **including order-taking, clock-in/out, and first-login PIN setup**, so an employee can do their whole job from a browser. *(This reverses the original design, which kept order-taking and clock-in/out tablet-only and treated the web as an oversight-only companion. The trade-off — the POS is now reachable from any browser with a valid PIN, not just the physical shop devices — is accepted; role/section permissions are still enforced server-side. See §7.)*
- **Backend server** — Python + FastAPI, Linux-hosted, exposes REST API, owns all business logic (stock deduction, cost calc, reporting). Same API serves the tablets and the web dashboard — no duplicated business logic between clients.
- **Database** — PostgreSQL. Single source of truth for orders, products, ingredients, recipes, stock, expenses, reports, users.

Removing offline mode eliminates the hardest problem in the original design (conflict resolution across two devices editing the same stock/order asynchronously). The server now simply serializes every write.

Stock is treated as **informational, not a hard gate**: since stock entry won't always be kept perfectly up to date, an order can always be placed even if it would take an ingredient or product below zero. Stock levels simply go negative and low-stock alerts fire — they never block a sale.

---

## 2. Core Modules

### A. Order Management
- **New order screen**: a "+" button adds a new line item to the order
- **Product search-as-you-type**: adding a line opens a search bar with autocomplete/fuzzy matching — typing the first few letters of a product name (e.g. "cro" → "Croissant") filters/ranks matching products live, no need to type the full name or browse a list
- **Per-line quantity control**: each added line shows a quantity field beside it that can be either typed directly or adjusted with press/step controls (e.g. +/- buttons)
- Notes per line item, plus general order-level notes (e.g. "they come and sit" for a dine-in customer)
- **Notes are persisted with the order** and visible whenever the order is reopened later (not just at creation time)
- **Each note has a checkbox to mark it "done"** — lets staff track and clear action items (e.g. a dine-in note, a payment reference) without deleting the note itself; done notes stay visible but shown struck-through/greyed
- **Client name and phone number** recorded on every order
- **Order date** — recorded automatically at creation, not manually entered
- **Needed-for date** — a separate field for the date the order is needed by/for (pickup or delivery date), distinct from the order date; matters for custom/advance orders like cakes
- **Fulfillment type** — Pickup or Delivery toggle. Choosing Delivery reveals a **manually-entered delivery price** field (free-entry number box, not auto-calculated), since delivery pricing varies by distance/arrangement, plus a **delivery address** field (street address / apartment / any delivery instructions)
- **Card message** — a dedicated note box, separate from general order notes, for a message to be written on a cake or card (e.g. "Happy birthday! Love, the family")
- **Payment timing** — Pay now or Pay later toggle
  - Pay now: choose a method — **Cash, Card, or E-transfer**. Card still opens the payment-notes popup below
  - Pay later: order is marked **Unpaid**; a **"Mark as paid" action** flips it to Paid once payment is received (e.g. cash or e-transfer collected on pickup/delivery day), recording who marked it and when
- Payment type popup — **selecting "Card" opens a popup modal for payment notes** (e.g. terminal reference, last 4 digits, approval code) with Cancel/Save; saved as a note on the order with its own done checkbox; Cash and E-transfer need no popup
- **Delivery manifest**: a table of every order with fulfillment type = Delivery, showing time needed, client, phone, address, item list, a **box count**, order total, and paid/unpaid status. Filterable by date range (defaults to today). Exportable to CSV and printable.
  - **Box count ≠ total quantity** — it's the number of distinct line items on the order, since each product line is packed as its own box/container regardless of how many units are inside. E.g. "12 cupcakes" + "20 brownies" on one order = **2 boxes**, not 32.
- **Order list filters**: date range (order date or needed-for date), order status, paid/unpaid, pickup/delivery, and free-text filter by product name (find every order containing a given product)
- Order status: pending → in progress → ready → completed
- **Idempotency key** on order creation — each order submission carries a client-generated UUID; server deduplicates retried requests (e.g. tablet re-sends after a slow network response) so a flaky connection can't create duplicate orders
- **Row-level locking on order edits** — if tablet B opens an order tablet A is currently editing, tablet B gets a "currently being edited by [user]" notice and a read-only view until A saves or releases it
- Order history, daily export
- **Receipt printing** — the app generates a PDF (headed with the business profile name/address/phone) and hands it to the **tablet's native Android print/share sheet**. There is no server-side printer configuration at all — the OS-level print dialog can target any printer the tablet can discover (including a regular HP printer), or share/save the PDF instead. This replaces an earlier design that had the server hold a specific printer address; that's been removed as unnecessary complexity
  - **Known limitation**: the PDF library's core fonts are latin-1 only, so accented text renders fine but **emoji degrade to `?`** — worth knowing since card messages are exactly the kind of field someone might put an emoji in
- **Cancellation**: cancelling an order always prompts a confirmation dialog. The dialog includes an optional "Reverse Stock" action — if pressed, stock quantities deducted for that order are added back; if not pressed, the cancellation is recorded but stock is left as-is (e.g. because the items were already made/wasted)
- **Orders are always editable**, regardless of paid/unpaid status — no lock-after-payment rule
- **Fulfillment completion** — replaces the generic "Completed" status for orders with a fulfillment type. A single action button reads **"Mark as delivered"** (Delivery orders) or **"Mark as picked up"** (Pickup orders); internally both set the order to a `fulfilled` state, recording who completed it and when
- **Fulfilled orders move to a separate section** — once marked delivered/picked up, an order leaves the active pipeline (Pending/In progress/Ready) and lands in its own **Fulfilled orders** list, so the working board only ever shows orders still in progress. Fulfilled orders remain fully searchable/filterable there (§2A order list filters still apply)
- **Overdue flag** — if an order's needed-for date/time passes while it's still not fulfilled (not yet delivered/picked up), it's shown in **red** on the order list, status board, and deliveries table, so nothing slips

### B. Inventory & Stock
- Ingredient stock levels, product stock levels
- Automatic deduction via recipe on sale, inside the same DB transaction as order creation — **deduction always proceeds even if it drives a level negative; insufficient stock never blocks or delays a sale** (see §1)
- **Dual deduction for recipe products**: selling a product that has a recipe decrements **both** the product's own finished-goods stock **and** the recipe's ingredient quantities, in the same transaction. Selling a product with no recipe (a bought-in/resale item) decrements only that product's own stock. This is required for the Production Summary's "current stock" / "to bake" numbers (§2D) to mean anything — if a product's own stock never moved on sale, that report would be wrong. Made-to-order items with no real pre-made stock simply sit at/below zero, which is fine (stock never blocks a sale, §1)
- Manual stock adjustments (with audit log: who, when, why)
- Low-stock alerts (push to both tablets) — advisory only, not a block
- Purchase logging, optional waste tracking
- **Filters**: Ingredients vs Products tab, free-text name search, and a "low/negative stock only" toggle

### C. Recipe Module
- Recipes link products to ingredient quantities
- Automatic deduction on sale
- Per-product cost calculation from ingredient costs

### D. Bookkeeping & Reports
- Daily sales report, payment breakdown, ingredient cost tracking, expense logging, profit calculation
- Export CSV/PDF
- Monthly summaries, with a custom date-range filter (not just Daily/Monthly presets)
- **No archival** — all order history is retained indefinitely in the primary tables; nothing is rolled off into a separate archive. (Worth revisiting only if the tables grow large enough to slow queries down the line — standard indexing/pagination should absorb normal growth for a two-tablet shop.)
- **Production summary (bake list)** — a table totaling the quantity of each product needed **across all orders** in a selected date range (filterable by date range/presets like Today, Tomorrow, This week, and by pickup/delivery). Columns: product, total quantity needed, number of contributing orders, current stock on hand, and quantity still to bake (needed minus in-stock). Exportable to CSV and printable, so it doubles as a daily prep sheet for the kitchen.

### E. User Roles & Auth
- Roles: Cashier (orders only), Manager (stock + orders), Admin (full access) — these define the **default** section access for a new employee.
- **Per-employee section access (overrides role defaults)** — beyond the three roles, an Admin can add/remove individual **sections** per employee from the Employees screen: Orders, Stock, Reports, Production, Deliveries, Tasks, Notifications, Time, Settings. An explicit per-employee list **overrides** the role's defaults (can grant *or* remove sections relative to the role); leaving it unset falls back to role defaults. Admins always retain every section, and managing employees/permissions itself stays admin-only (so the privilege-escalation surface is closed). Enforced **server-side** (403 on a missing section) and reflected in each client's nav / route guards. See [`docs/PERMISSIONS.md`](PERMISSIONS.md).
- **Every employee logs in with a PIN.** Admin adds a new employee (name, role) from the Employees screen; the employee then **sets their own PIN** on first login rather than the Admin choosing it for them
- PIN entry issues a short-lived JWT session token, standard for a shared shift device
- **Admin can reset a forgotten PIN** — a reset clears the employee's PIN and puts their account back into "first login" state, so they set a new one themselves the same way as when first added. Without this, a forgotten PIN would permanently lock an employee out

### F. Connectivity Handling (replaces old "Sync & Offline" module)
- Tablets poll or hold a WebSocket connection to the server for live order/stock updates across devices
- On connection loss: app locks new order/stock actions, shows reconnect banner, auto-retries connection
- No local persistence of unsynced writes — nothing to reconcile once reconnected, by design

### G. Employee Management & Time Tracking (new)
- **Admin can add/edit/remove employees**, assigning each a role and a login PIN
- **Clock in / clock out**: each employee clocks in and out from the tablet (PIN-authenticated tap), timestamped by the server
- **Weekly hours table**: for each employee, a table showing hours worked per day for the week (and the running weekly total)
- **Admin view**: Admin can view the hours table for every employee, not just their own — a dashboard/report across all staff for a given week or date range
- Clock-in/out records feed into payroll-adjacent reporting but do not need to calculate pay (unless you want that added later)

### H. Notifications (new)
- A single **Notifications screen/feed** aggregating everything that needs attention: low/negative stock alerts, overdue orders (needed-for date passed without being marked delivered/picked up), and possibly unresolved order notes
- Each notification links back to the relevant order or stock item; can be marked read/dismissed
- Badge count on the nav icon for unread notifications
- **All notifications actively ping** — the moment one is created, it's pushed live to both tablets over the existing WebSocket connection (§2F) as a banner/toast plus a sound, not just a passive item waiting in the feed. Every notification type (low stock, overdue order, overdue task) pings the same way

### I. Admin / Settings (new)
- **Products**: add/edit/deactivate — name, price, category, active/inactive toggle, optional photo. This is the catalog the order-screen search bar and the search index (§5) draw from
- **Ingredients**: add/edit/deactivate — name, unit of measure (kg, g, unit, etc.), cost per unit (feeds recipe cost calc, §2C), low-stock threshold (per-ingredient, not a single global number)
- **Recipes**: the builder UI for linking a product to its ingredient list + quantities (the module itself is §2C; this is where Admin edits it)
- **Business profile**: bakery name, address, phone — used as the header on the receipt/manifest PDFs (§2A)
- **Employees**: add/remove employees and set roles (cross-reference §2E/§2G — the account-creation half of that flow lives here)

### J. Tasks (new)
- **Admin/Manager can create a task**: description, assigned employee, and a due date
- **Employee sees their own assigned tasks** and can **check them off as done** (same checkbox pattern as order notes — done tasks stay visible, greyed/struck-through, rather than disappearing)
- **Admin/Manager view**: a table of all tasks across every employee, filterable by employee, date, and done/pending status
- Overdue tasks (due date passed, not done) are flagged the same way overdue orders are (§2A) — highlighted red

---

## 3. Tablet App Workflows

**Order workflow:** select "New Order" → choose products → quantity/notes → server calculates price → select payment → submit with idempotency key → server confirms → both tablets' order lists update live.

**Stock workflow:** tablet reads live stock from server → manual adjustment or automatic recipe deduction on sale → server commits in one transaction → both tablets reflect new levels immediately → low-stock alert pushed if threshold crossed.

**Bookkeeping workflow:** server aggregates orders continuously → daily report generated on demand or on a schedule → tablets view/export → monthly summary auto-generated.

**Time tracking workflow:** employee enters PIN → taps clock in → server timestamps it → same flow for clock out at shift end → server computes daily/weekly totals → employee sees their own week table; Admin sees everyone's.

**Cancellation workflow:** user selects "Cancel Order" → confirmation dialog appears every time → optional "Reverse Stock" toggle/button in the dialog → on confirm, order marked cancelled and, if selected, deducted stock is restored.

---

## 4. Backend Architecture (FastAPI)

Example endpoints (add `/api/v1/` prefix for versioning):

- `POST /orders` (idempotency key required)
- `GET /orders` (paginated)
- `PUT /orders/{id}`
- `POST /orders/{id}/cancel` (body: `reverse_stock: bool`)
- `POST /orders/{id}/mark-paid` (toggles paid/unpaid, records who + when; **also captures the payment method used** — Cash/Card/E-transfer — so pay-later collections land in the correct bucket on the payment breakdown report instead of an "unspecified" catch-all)
- `POST /orders/{id}/fulfill` (marks delivered/picked up based on `fulfillment_type`, records who + when)
- `GET /notifications` / `POST /notifications/{id}/read`
- `POST /auth/set-pin` (first-login PIN setup for a newly added employee)
- `GET /auth/roster` (unauthenticated — minimal employee list powering the "tap your name" login picker before PIN entry; a conscious trade-off since names are then visible to anyone reaching the API, not just staff at the shop, see §7)
- `WS /api/v1/ws?token=<jwt>` (the real-time transport behind "notifications ping" and "both tablets update live" — pushes `orders_changed`, `stock_changed`, and `notification` events; this is what §2F/§2H's `emit` hook broadcasts through)
- `POST /employees/{id}/reset-pin` (Admin only; clears the PIN and returns the account to first-login state)
- `POST /tasks` (Admin/Manager only; body: description, assigned_to, due_date)
- `GET /tasks?employee_id=&date=&done=` (own tasks by default; Admin/Manager can query any employee)
- `POST /tasks/{id}/done` (toggles done/not done, records who + when)
- `POST /products` / `PUT /products/{id}` (Admin only)
- `POST /ingredients` / `PUT /ingredients/{id}` (Admin only)
- `GET /settings/business-profile` / `PUT /settings/business-profile` (name, address, phone for receipt/manifest PDF headers)
- `GET /deliveries?from=&to=` (delivery manifest: filters orders to fulfillment_type=delivery for the given date range, with box count computed as distinct order-line count per order)
- `GET /deliveries/export?from=&to=&format=csv` (manifest export/print source)
- `GET /reports/production?from=&to=&fulfillment=` (bake list: total quantity per product across all orders in range, joined against current stock, minus to compute "to bake")
- `GET /products/search?q=` (typeahead/fuzzy match for the order search bar)
- `POST /stock/adjust`
- `GET /stock`
- `POST /recipes`
- `GET /reports/daily`
- `GET /reports/monthly`
- `POST /auth/login` (PIN-based)
- `POST /employees` / `GET /employees` (Admin only)
- `POST /time/clock-in` / `POST /time/clock-out`
- `GET /time/hours?employee_id=&week=` (own hours; Admin can query any employee)
- `GET /health` (monitoring)

Business logic responsibilities: stock deduction (never blocking), expense tracking, profit calculation, idempotency handling, row-locking on concurrent edits, low-stock alert triggers, weekly hours aggregation.

Non-functional basics to include from the start: pagination on list endpoints, basic rate limiting, structured logging, and API versioning — all cheap to add now, expensive to retrofit.

**Error handling** — standard REST conventions: 400 for validation errors, 401/403 for auth/permission failures, 404 for missing resources, 409 for conflicts (e.g. idempotency key reuse with different payload), 500 for unhandled errors. All error responses share a consistent JSON shape (`{ "error": { "code": ..., "message": ... } }`) so the tablet app can handle them generically rather than per-endpoint.

---

## 5. Database Schema (PostgreSQL)

Tables: `products`, `ingredients`, `recipes`, `recipe_items`, `orders`, `order_items`, `order_notes` (one row per note: order_id, text, type [general/payment], done: bool, created_at), `stock_levels`, `stock_adjustments` (audit log for manual changes), `expenses`, `users` (employees, with role + PIN hash), `time_entries` (clock-in/out timestamps per employee), `daily_reports`, `notifications` (type, message, related order/stock id, read: bool, created_at), `tasks` (description, assigned_to, assigned_by, due_date, done: bool, done_at, done_by, created_at).

No `order_archive` table — all order history stays in the primary `orders`/`order_items` tables indefinitely; nothing is rolled off.

`orders` columns to add: `client_name`, `client_phone`, `order_date` (auto, server-set), `needed_for_date`, `fulfillment_type` (pickup/delivery), `delivery_price` (nullable numeric, manually entered), `delivery_address` (nullable text), `card_message` (text), `payment_timing` (now/later), `payment_method` (cash/card/etransfer), `paid_status` (unpaid/paid), `paid_at` (nullable timestamp), `paid_by` (nullable user id), `fulfillment_status` (pending/fulfilled), `fulfilled_at` (nullable timestamp), `fulfilled_by` (nullable user id).

`products` columns: `name`, `price`, `category`, `active: bool`, `photo_url` (nullable).

`ingredients` columns: `name`, `unit` (kg/g/unit/etc.), `cost_per_unit`, `low_stock_threshold`.

`users` columns: PIN is stored as a hash, set by the employee on first login (not assigned by Admin) — Admin only sets name/role when creating the record; `pin_set: bool` tracks whether the employee has completed first-login PIN setup.

Relationships: Products → Recipe → Ingredients; Orders → Order Items → Products; Stock Levels → Ingredients + Products; Time Entries → Users.

`products` needs a name column indexed for fast prefix/fuzzy search (e.g. Postgres trigram index via `pg_trgm`) to support the order-screen typeahead.

Order cancellations record whether stock was reversed (`orders.stock_reversed: bool`) so reports can distinguish true waste from restocked cancellations.

(`sync_log` table removed — no longer needed without offline sync.)

---

## 6. Security

- JWT session tokens issued after PIN login
- Role-based permissions enforced server-side on every endpoint
- HTTPS only
- Daily encrypted DB backups
- No local encrypted storage needed on tablets (no offline data to protect) — reduces attack surface

---

## 7. Decisions

Resolved:
- **Hosting** — cloud-hosted, provider not yet chosen (AWS, DigitalOcean, GCP, or similar all work — the FastAPI + Postgres stack is provider-agnostic via Docker). Provider choice can be made at deployment time, not a build-blocking decision. Tablets connect to the server over the internet, not just local Wi-Fi — so whichever provider is picked, the server needs a public/VPN-reachable address, TLS certificate, and standard cloud security-group hardening.
- **Stock vs. orders** — orders are never blocked by insufficient stock; stock is advisory (see §1, §2B).
- **Order cancellation** — always confirm; optional "Reverse Stock" action.
- **Order editing** — orders remain editable at any time, including after being marked paid.
- **No deposit/partial-payment option** — Pay now / Pay later only; a "deposit now, rest later" flow is explicitly out of scope for v1.
- **Receipt printing** — PDF generation only, no server-side printer config; printed via the tablet's native Android print/share sheet, which can target any printer (including a regular HP printer) or share/save the file instead (§2A).
- **Web dashboard scope** — the web is a **full client at parity with the tablet**, not an oversight-only companion: it does order-taking, clock-in/out, and first-login PIN setup, for all employees. *This reverses the earlier tablet-only-POS boundary (order-taking and clock-in/out were originally kept to the shop devices).* Accepted trade-off: the POS is reachable from any browser with a valid PIN, not only the physical shop devices. Role/section permissions remain enforced server-side (§6), so what each employee can actually reach is still controlled centrally.
- **Per-employee section permissions** — access is controlled per employee by section, **overriding** role defaults (admin-configurable from the Employees screen). Roles become the starting default; an employee's explicit section list is the source of truth when present. Admins always keep every section; only admins manage permissions. Enforced server-side. See §2E and [`docs/PERMISSIONS.md`](PERMISSIONS.md).
- **PIN auth** — every employee has a PIN; Admin creates the employee record, the employee sets their own PIN on first login.
- **Overdue orders** — flagged red once the needed-for date passes without the order being marked delivered/picked up.
- **Fulfilled orders live separately** — delivered/picked-up orders move out of the active pipeline into their own Fulfilled orders section (§2A).
- **No data archival** — everything stays in the primary tables indefinitely (§2D, §5).
- **Notifications actively ping** — pushed live to both tablets via banner/toast + sound the moment they're created, not just sitting passively in the feed (§2H).
- **Error handling** — standard REST status codes + consistent error JSON shape (see §4).
- **Testing and monitoring** — both required, see §8 and §10.

Still open (Claude shouldn't guess at these):
1. **Cloud provider and specific services** — not urgent; decide at deployment time (which managed DB service, compute option, region, budget/scale expectations).
2. **Ping channel scope** — pings are specified as in-app (banner/toast + sound on the tablets themselves). If you also want alerts to reach a phone outside the app (SMS/push notification when the shop is closed, say), that's a separate integration to decide on.
3. **Unauthenticated employee roster** — accepted for now as the simplest way to power the login picker (§4 `GET /auth/roster`), but worth revisiting if exposing staff names to anyone who reaches the public API ever becomes a concern.

---

## 8. Recommended Build Order

Building "everything at once" tends to produce shallow, generic code across every module. Suggested phasing, each reviewed before the next starts:

1. Database schema + core Order and Inventory APIs (with transactional, non-blocking stock deduction and idempotency keys)
2. Auth (PIN/JWT) + role permissions + employee management + clock-in/out
3. Reports & bookkeeping module (including weekly hours reports)
4. Tablet app (React Native): **the full app** — order screen (search-as-you-type + quantity controls) first since it's the core POS flow, then status board, stock, employee hours + clock-in/out, deliveries, production summary, tasks, and notifications, all wired to the above. This is the largest phase; the order screen is the natural starting point within it, not the entire scope of the phase.
5. Web dashboard — **a full client at parity with the tablet**, reusing the same API (no new backend work — just a second frontend): all §11 screens, **including order-taking and clock-in/out**, plus first-login PIN setup. *(Originally scoped as a non-POS oversight companion; expanded to a full client per §7.)*
6. Receipt printing + polish
7. Testing pass (unit + integration) and monitoring setup (see §10) before go-live

---

## 9. Final Output Expected From Claude

- Backend code (FastAPI)
- Database schema (PostgreSQL)
- Tablet app (React Native)
- All workflows above
- File/folder structure
- Documentation
- Automated tests (see §10)
- Monitoring/health-check setup (see §10)

---

## 10. Testing & Monitoring

**Testing** (required, not optional):
- Unit tests for business logic: stock deduction math, idempotency handling, hours aggregation, cancellation/reverse-stock logic
- Integration tests for API endpoints (order creation, cancellation, clock in/out, reports) against a real test database
- At least a smoke-test suite for the core order flow (add item via search → set quantity → submit order)

**Monitoring**:
- `GET /health` endpoint checked by an uptime monitor (e.g. AWS CloudWatch or a third-party pinger), since tablets can't function at all if the cloud server is unreachable
- Structured application logging (requests, errors, stock changes) shipped somewhere queryable (CloudWatch Logs or equivalent)
- Alerting on server downtime and on repeated 5xx errors

---

## 11. UI

Navigation: a persistent side rail (Orders, Stock, Reports, Employees, Time) plus a user avatar for the currently clocked-in staff member. Screens designed so far:

**New order screen** — a Customer & order info section at top: client name, phone number, an auto-set "Ordered" date (read-only), a "Needed for" date field, a Pickup/Delivery toggle (Delivery reveals a manually-entered delivery price box), and a Card message box for cake/card inscriptions. Below that, the item list: a search bar at top with a round "+" button beside it — typing the first few letters of a product name (e.g. "cro") shows a live fuzzy-matched dropdown of results to tap, or the "+" button adds a blank line directly. Each added line shows product name, an editable notes field, a quantity control (tap +/- or type the number directly), and line total, with an "x" to remove. At the bottom, a Payment section: Pay now/Pay later toggle. Pay now shows Cash/Card/E-transfer method pills (Card opens a popup modal for payment notes, e.g. terminal reference or approval code, with Cancel/Save) next to the running total and Submit button. Pay later shows an Unpaid badge and a "Mark as paid" button instead of payment methods.

**Order detail / notes view** — reached by opening an order from history or the status board. Shows order items and a Notes section: every note (general, like "they come and sit" for a dine-in customer, or the saved card payment note) is its own row with a checkbox. Checking it marks the note done — it stays visible but greys out and gets struck through, rather than being deleted.

**Order status board** — three columns (Pending, In progress, Ready), color-coded, each order shown as a card with item count, total, and a small note-flag icon if it has unresolved (unchecked) notes. Tapping a card opens the order detail view. Once an order is marked delivered/picked up it drops off this board entirely and moves to the separate Fulfilled orders section below.

**Fulfilled orders section** — a separate list/tab (outside the active board) for every order already delivered or picked up, still fully searchable and filterable using the same Orders filters (§2A). Keeps the working board showing only what's still in progress.

**Stock screen** — tabs for Ingredients vs Products, a search bar, and a low-stock banner summarizing how many items are low or negative. Each row is color-coded (green = ok, amber = below threshold, red = negative) with inline +/- adjust controls; a "Log purchase" button at top handles restocking. Rows can go and display negative values, since stock never blocks a sale (§1, §2B).

**Employee hours screen** — Admin sees a left-hand list of all employees with their weekly total hours; selecting one shows a Mon–Sun grid of daily hours, the weekly total, a Clock in/Clock out button (for the currently logged-in user), and a list of recent raw clock-in/clock-out entries. Non-admin roles see only their own hours (no employee list).

**Reports screen** — Daily/Monthly toggle at top, metric cards (Revenue, Orders, Ingredient cost, Profit), a Cash vs Card breakdown bar, and a list of expenses logged that day/month. **Every metric card and breakdown row is tappable and drills into itemized detail** — e.g. tapping Revenue expands the list of contributing orders, tapping the Cash or Card bar lists the matching transactions, tapping an expense row opens/edits that expense. An Export CSV button sits at top.

**Deliveries screen** — a table of every delivery order for the selected date range (default today): time needed, client, phone, address, item list, box count, total, and paid/unpaid status, with Print and Export CSV buttons at top. Box count reflects distinct order line items, not summed unit quantity (§2A).

**Orders screen filters** — a filter bar above the order table/list: product-name search, date-range pickers, and dropdowns for status, paid/unpaid, and pickup/delivery, with a Clear button. Same filter pattern (date range, relevant status dropdowns) applies to Reports and Deliveries.

**Production summary (bake list) screen** — date-range presets (Today, Tomorrow, This week) plus custom date range and a pickup/delivery filter, above a table: product, total quantity needed across all matching orders, number of contributing orders, current stock on hand, and quantity still to bake — with a totals row, Print, and Export CSV.

**Fulfillment & overdue handling** — every order detail/list view shows a "Mark as delivered" (Delivery) or "Mark as picked up" (Pickup) button once an order is Ready. If the needed-for date/time passes before that button is pressed, the order is highlighted red everywhere it appears (order list, status board, deliveries table) until fulfilled.

**Notifications screen** — a feed of everything needing attention: low/negative stock, overdue orders, etc., each linking back to the relevant order or stock item, markable as read. A badge on the nav icon shows the unread count. Every new notification also pings live on both tablets (banner/toast + sound) the moment it's created, rather than waiting to be checked.

**Tasks screen** — Admin/Manager can add a task (description, assigned employee, due date). Employees see their own task list with a checkbox to mark each done (same greyed/struck-through pattern as order notes). Admin/Manager additionally sees a table of every employee's tasks, filterable by employee, date, and done/pending, with overdue (past due date, not done) tasks highlighted red.

*(Additional screens — recipes, settings/admin, PIN login/first-time-PIN-setup — not yet mocked up.)*
