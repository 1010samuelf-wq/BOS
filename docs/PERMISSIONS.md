# Per-employee section permissions

Fine-grained access control layered on top of roles (owner decision). An admin
can add/remove **sections** per employee — e.g. limit someone to Orders only.

## Model (override)

- Each area of the app is a **section**: `orders, stock, reports, production,
  deliveries, tasks, notifications, time, settings` (+ `employees`, admin-only).
- An employee's **effective sections** = their explicit `permissions` override
  if set, else their **role's defaults**. Setting `permissions` overrides the
  role entirely (can grant *or* remove beyond the role).
- **Admins always have every section** — they can't lock themselves out.
- `employees` (managing people + permissions) is **admin-only and not
  grantable**, which keeps the privilege-escalation surface closed: only admins
  decide who-can-do-what.

Role defaults: cashier → `orders, tasks, notifications, time`; manager → those +
`stock, reports, production, deliveries`; admin → everything.

## Enforcement (server-side, authoritative)

`app/core/permissions.py` provides `require_section("x")` /
`require_any_section(...)`, applied at router or endpoint level. The nav-hiding
in the frontends is cosmetic; the API is the real gate (403 on a missing
section). Product search/list is `require_any_section("orders", "settings")` so
order-takers and catalog-editors can both use it.

- `GET /employees/sections` — the grantable list (for the editor UI).
- `PUT /employees/{id}` accepts `permissions: [...]` (explicit) or `null`
  (reset to role default). Validated against the grantable set.
- Login (`/auth/login`) returns the employee's effective `sections`; the web
  filters its sidebar + guards routes by them.

## UI

Admin → **Employees & hours** → each employee has a **Sections** checklist
(pre-filled with their effective set) + a "Reset to role default" button. Admin
rows show "Full access". Changes take effect on the employee's next login.

## Verified

- Backend: 84 tests green, incl. `test_permissions.py` (restrict-to-orders,
  grant-beyond-role, reset, admin-always-all, validation, sections catalog,
  non-admin-can't-edit).
- Live (web): admin unchecked a cashier's "notifications" → her nav dropped to
  Orders + Tasks on next login; admin has full nav; cashier defaults filter
  correctly.
