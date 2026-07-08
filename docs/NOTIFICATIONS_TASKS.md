# Notifications & Tasks — design notes & review checklist

Backend modules built between Phase 3 and Phase 4 so the API is complete before
the frontends. Real-time delivery is intentionally left as a Phase-4 hook.

## Decisions taken here (and why)

1. **One creation path, one real-time hook.** Every notification is created via
   `notifications.create(...)`, which calls `emit(...)`. Low-stock alerts (from
   the stock service) and overdue alerts both go through it. Phase 4 replaces
   only `emit`'s body with a WebSocket broadcast + sound to both tablets
   (§2F/§2H) — no call sites change.

2. **Generation, not just storage.** Low/negative stock is event-driven and
   written the instant a level crosses its threshold. Overdue orders/tasks are
   *time*-driven, so `refresh_overdue` scans and creates them; it runs lazily on
   every feed / badge-count read (so the feed is current without a scheduler)
   and is also exposed as `POST /notifications/scan` for a cron.

3. **Dedup so nothing nags twice.** `refresh_overdue` skips any order/task that
   already has an `overdue_order` / `overdue_task` notification (read or not).
   An order/task fires exactly once when it first goes overdue.

4. **Low-stock fires on the downward crossing only** (carried over from Phase 1)
   — previous > threshold and new ≤ threshold — so repeated sales below the line
   don't spam. `BOS_LOW_STOCK_RENOTIFY=true` re-fires on every dip if wanted.

5. **`related_task_id` added to `notifications`** (migration `0002`) so overdue
   task alerts link back to the task, mirroring `related_order_id` and the
   stock `related_item_*` links. Migration is idempotent — a no-op on a fresh DB
   where `create_all` already made the column.

6. **Task visibility & permissions.** Create = Admin/Manager. List defaults to
   the caller's own tasks; Admin/Manager can query any employee or all. Done
   toggle = the assignee or Admin/Manager. `is_overdue` (due passed, not done)
   is computed for the red-highlight (§2J); a done task is never overdue.

## What was verified

- `pytest` — 55 tests green. New coverage:
  - low-stock notification on threshold crossing; unread count + mark-read +
    read-all.
  - overdue-order generation + dedup on re-scan; fulfilled order not flagged.
  - overdue-task generation with `related_task_id`.
  - task create (Mgr+; cashier 403), own-only visibility (+403 cross-query,
    admin sees all), assignee done-toggle on/off, non-assignee 403, admin
    override, done → not overdue.
- `alembic upgrade head` reaches `0002_notif_task` cleanly on a fresh DB.

## Known limitations / out of scope here

- Real-time push/sound is the Phase-4 deliverable (only the hook exists now).
- "Dismiss" is modelled as mark-read (single `read` flag); the feed keeps read
  items. Add a separate `dismissed` flag only if the UI needs to hide them.
- Unresolved order *notes* are not surfaced as notifications (spec calls this
  "possibly"); the status board's note-flag already covers them.
- Overdue scan is O(active orders + open tasks) per call — fine at shop scale;
  add a scheduler + incremental scan if volume ever grows.
