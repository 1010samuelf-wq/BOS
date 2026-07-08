# Phase 2 — design notes & review checklist

Covers spec §8 step 2: **Auth (PIN/JWT) + role permissions + employee
management + clock-in/out.**

## What changed since Phase 1

- **Auth is now real.** The `X-User-Id` stand-in is gone. `current_user`
  (`app/core/auth.py`) requires an `Authorization: Bearer <jwt>` header, decodes
  the HS256 token, and loads an active user. Every route except `/health`,
  `/auth/login`, and `/auth/set-pin` is now authenticated.
- **Actor recording** from Phase 1 (`paid_by`, `fulfilled_by`, `cancelled_by`,
  `adjusted_by`, lock holder) now carries a genuinely authenticated id.

## Decisions taken here (and why)

1. **PIN hashing without a crypto dependency.** PBKDF2-HMAC-SHA256 + per-PIN
   salt via stdlib `hashlib` (`app/core/security.py`), 200k iterations,
   constant-time verify. Avoids the passlib/bcrypt wheel friction on Python 3.14
   while staying appropriate for short numeric PINs.

2. **First-login PIN setup is unauthenticated by design.** A freshly created
   employee has no token yet, so `POST /auth/set-pin` is open — but only works
   while `pin_set` is false (re-set → 409). Admin never chooses the PIN
   (spec §2E). An Admin can *reset* a PIN via
   `POST /employees/{id}/reset-pin`, which clears the hash and flips `pin_set`
   back to false so the employee sets a fresh PIN on next login.

3. **Login is `user_id` + PIN**, matching a shared shift device where the UI
   lists employees to tap. Missing user and wrong PIN both return an identical
   `401 invalid_credentials` so the endpoint doesn't enumerate employee ids.

4. **Role model is a total order** — `cashier < manager < admin` — enforced with
   `require_min_role`. Orders = any authenticated; stock adjust = manager+;
   catalog + employees = admin. Admin implicitly passes every check, so there's
   no per-endpoint role list to keep in sync.

5. **"Remove employee" is a soft deactivate** (`active=False`), not a delete, so
   historical orders and time entries keep their FK references. A deactivated
   user's existing tokens stop working immediately (the `current_user` active
   check).

6. **Hours attribution is by clock-in day**, and open shifts count up to "now".
   `aggregate_week` is a pure function (no DB) so the math is unit-tested in
   isolation; the DB wrapper just feeds it rows. Shifts crossing midnight are
   attributed wholly to the clock-in date — documented, revisit if payroll needs
   split-at-midnight.

## What was verified

- `pytest` — 33 tests green on SQLite. New Phase-2 coverage:
  - set-pin → login happy path; login-before-pin (403), wrong pin (401),
    re-set pin (409).
  - protected route without/with-bad token → 401.
  - role matrix: cashier blocked from stock adjust + catalog; cashier can take
    orders; manager can adjust stock but not catalog; admin-only employees.
  - employee CRUD + soft-remove visibility; deactivated token rejected.
  - `week_bounds`, `aggregate_week` (sums, open entry, out-of-week exclusion);
    clock-in/out flow with double-clock-in (409) and clock-out-without-in (409);
    hours visibility (self ok, other cashier 403, admin any).

## Known limitations / out of Phase 2

- No refresh tokens or server-side token revocation list — deactivating a user
  is checked live, but a stolen token is valid until `exp` (12h default). Fine
  for an in-store device; revisit if tokens leave the shop.
- Rate limiting is the shared global middleware; no dedicated login-attempt
  lockout (add if brute-force over the network is a concern).
- `BOS_JWT_SECRET` defaults to a dev value — **must** be overridden in prod.

## Suggested review focus

- `app/core/security.py` — PIN hashing + JWT issue/verify.
- `app/core/auth.py` — the `current_user` / `require_min_role` gate.
- `app/services/time_tracking.py::aggregate_week` — the hours math.
- Role assignments across `stock.py`, `catalog.py`, `employees.py`, `time.py`.
