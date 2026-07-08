# Phase 1 — design notes & review checklist

This is the review artifact for the first phase in the spec's build order (§8):
**database schema + core Order and Inventory APIs, with transactional,
non-blocking stock deduction and idempotency keys.**

## Decisions taken here (and why)

1. **Models are the source of truth; migrations mirror them.**
   `alembic/versions/0001_initial.py` calls `Base.metadata.create_all` and then
   adds the Postgres-only extras (`pg_trgm` + trigram index on `products.name`,
   §5) and seeds the `system` user. `schema.sql` is a hand-kept readable mirror
   for reviewers who want plain DDL. Trade-off: autogenerate diffs are simpler
   from here on; the initial migration isn't a column-by-column script.

2. **All §5 tables exist now**, even those without Phase-1 endpoints
   (`tasks`, `notifications`, `time_entries`, `expenses`, `daily_reports`, full
   `users`). Cheap now, avoids a second migration when later phases add their
   routes.

3. **Stock is one table for two item kinds.** `stock_levels(item_type,
   item_id)` with an `ItemType` discriminator serves ingredients and products
   through one code path. Every mutation writes a signed `stock_adjustments`
   audit row — manual, sale, or reversal.

4. **Non-blocking deduction, serialized writes.** `apply_delta` fetches the
   level `FOR UPDATE` (Postgres) so concurrent deductions serialize rather than
   race, then applies the delta unconditionally — negative is allowed (§1). On
   SQLite the lock hint is a no-op, which is fine for the test suite.

5. **Dual deduction (confirmed with the shop).** Every sale always deducts the
   product's own finished-goods stock, and additionally the recipe's ingredients
   when the product has a recipe. A product without a recipe only moves its own
   finished stock. Reversal (§6) negates whatever was recorded, so cancel
   restores both streams with no special-casing.

6. **Reversal by negating recorded adjustments**, not by recomputing from the
   recipe — stays correct if a recipe changed between sale and cancellation.

7. **Idempotency = key + payload fingerprint.** Same key + same body → return
   original (`200`); same key + different body → `409`. Fingerprint is a sha256
   of the create payload minus the key.

8. **Auth is a stand-in.** `current_user` resolves an `X-User-Id` header or
   falls back to the seeded `system` user. Phase 2 swaps only this module for
   real PIN/JWT; every route already records actor ids
   (`paid_by`, `fulfilled_by`, `cancelled_by`, `adjusted_by`, lock holder).

## What was verified

- `pytest` — 16 tests green on SQLite covering: total math, paid-now vs
  pay-later + mark-paid, delivery validation + price rollup, fulfilment,
  idempotent resubmit, idempotency conflict, product-name filter, row-lock
  conflict + owner re-edit, item-edit repricing, recipe deduction, sale into
  negative stock, finished-goods deduction, cancel ± reverse, low-stock filter,
  zero-delta rejection, health.
- `alembic upgrade head` on a fresh DB — creates all 16 tables, seeds the
  system user, stamps the revision.
- App boots and generates OpenAPI for all 16 endpoints.

## Known limitations / explicitly out of Phase 1

- No real auth / role gating yet (Phase 2). **Not internet-safe as-is.**
- In-process rate limiter and low-stock de-dup state are per-instance; fine for
  a single server, would need Redis if scaled horizontally.
- No WebSocket push yet (§2F/§2H) — notifications are written to the table but
  not yet streamed to tablets.
- Reports, deliveries manifest, production summary, tasks, time tracking:
  later phases.

## Suggested review focus

- `app/services/stock.py` — the non-blocking invariant and audit trail.
- `app/services/order.py` — idempotency, the edit lock, cancel/reverse.
- The dual-deduction rule (§5 above) and its reversal — product + ingredient
  streams both move on sale and both restore on reverse-cancel.
