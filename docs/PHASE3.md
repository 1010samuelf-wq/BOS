# Phase 3 — design notes & review checklist

Covers spec §8 step 3: **Reports & bookkeeping (including weekly-hours
reports).** All aggregation lives in `app/services/reports.py`; routers are thin.

## Decisions taken here (and why)

1. **Which date each report keys off.**
   - Financial (sales/daily/monthly, all-staff hours) → `order_date` /
     clock-in: "when the money/work happened."
   - Production and deliveries → `needed_for_date`: "when goods are due" — a
     prep/route sheet is about the future, not when the order was taken.
   Ranges are inclusive calendar dates interpreted as UTC (half-open
   `[from 00:00, to+1 00:00)` internally).

2. **What counts as revenue.** Booked total of all non-cancelled orders in the
   window, regardless of paid status — so a pay-later order is revenue now, and
   its cash appears under `unpaid` in the breakdown until collected. Cancelled
   orders are excluded everywhere.

3. **Payment breakdown buckets.** `cash / card / etransfer` for paid orders with
   a method, `unpaid` for booked-but-not-collected, and `unspecified` as a
   safety bucket for paid orders with no method. `mark-paid` now accepts an
   optional `payment_method` (resolved with the shop), so a pay-later order
   collected on pickup records how it was paid and lands in the right bucket;
   `unspecified` should only appear for legacy/edge data.

4. **Ingredient cost = recipe COGS.** Σ over sold line items of
   `unit_recipe_cost × quantity`, where unit cost is
   `Σ(recipe qty × ingredient.cost_per_unit)`. Products without a recipe
   contribute 0 (their cost isn't known to the system). Cost is cached per
   report to avoid re-querying a recipe per line.

5. **Profit** = revenue − ingredient_cost − expenses_total. Money fields are
   quantized to cents (`ROUND_HALF_UP`); quantities stay at 3 dp.

6. **Production `to_bake` is clamped at 0.** `needed − in_stock`, floored at
   zero (you don't bake negative). Excludes cancelled *and* fulfilled orders —
   fulfilled means already made/out. `in_stock` can still show negative (the
   dual-deduction rule from Phase 1), which correctly inflates `to_bake`.

7. **Box count = distinct line items**, not summed quantity — "12 cupcakes + 20
   brownies = 2 boxes" (spec §2A).

8. **Role gating.** Financial reports + expenses are Manager+; the production
   bake-list and delivery manifest are operational (kitchen / packing) and open
   to any authenticated user.

9. **CSV now, PDF later.** Export endpoints emit CSV (what the "Export CSV"
   buttons need). PDF export shares the same aggregation and is folded into the
   Phase 6 receipt/print work rather than pulling a PDF dependency in now.

## What was verified

- `pytest` — 42 tests green. New Phase-3 coverage:
  - sales report revenue + cash/card/unpaid breakdown + COGS + expenses +
    profit; cancelled order excluded from revenue.
  - production totals, contributing-order count, `in_stock`/`to_bake` math
    against negative stock; fulfilled/cancelled exclusion.
  - delivery manifest box-count (distinct lines) and pickup-order exclusion.
  - all-staff weekly hours totals.
  - role gating (cashier 403 on summary, 200 on production) and CSV content-type.

## Known limitations / out of Phase 3

- No `daily_reports` materialisation yet — reports compute on demand. Fine at a
  two-tablet shop's data volume; the table exists if a nightly rollup is wanted.
- PDF export deferred to Phase 6.
- Hours reports attribute a shift to its clock-in day (from Phase 2).

## Suggested review focus

- `app/services/reports.py` — the revenue/COGS/profit math and the date-keying
  choices (decisions #1–#5).
