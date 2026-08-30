# Offline tablet support — status & handoff

Let the tablets keep working with no connection — read cached data, queue writes
locally, sync automatically on reconnect — plus a manual "Work offline" switch
in the app.

> **Status: SHIPPED.** Built as APK **v1.1.0 (versionCode 4)** on 2026-08-30 and
> installed on a shop tablet; the owner confirmed the offline round trip works on
> real hardware — go offline, work, come back, everything lands. This is no
> longer in-progress. Two follow-ups remain, both listed below, neither blocking.
>
> Because the code is on `main` rather than in the working tree, the git-stash
> recipe at the bottom of this file does not isolate it. That only matters now
> for OTAs targeting the **old 1.0.0 runtime**; anything built from 1.1.0
> onwards already contains the native module, so ordinary OTAs are back to
> normal — see `CLAUDE.md` → Deploying.

## Scope (agreed with the owner)

| Works offline | Stays online-only (locked) |
|---|---|
| Orders — board, new, edit, notes, status, mark-paid, fulfill, cancel | Bookkeeping |
| Production / bake list | Settings (products, ingredients, recipes, profile) |
| Deliveries | Employees (admin edits) |
| Clock in/out + own hours | Notifications |
| Tasks (view + tick off; creating a task is manager-only, online) | |

## How it works

**Reads** — the React Query cache is persisted to AsyncStorage
(`@tanstack/react-query-persist-client`), so screens render last-known data
offline with an "as of {time}" label. Production/Deliveries additionally keep a
`useOfflineSnapshot` fallback, because they key their query by a date range
computed fresh at mount — a cache entry from yesterday is unreachable by key once
the date rolls over, so the persister alone leaves a blank screen.

**Writes** — queued in a local outbox (`tablet/src/offline/outbox.ts`, its own
AsyncStorage key `bos.outbox`, deliberately never touched by logout so a forced
re-login can't destroy unsynced work). On reconnect `OutboxProvider` flushes them
to `POST /api/v1/sync/replay` in order, then invalidates every query.

**Backend** — one generic dispatcher (`app/services/sync_dispatch.py`) maps an
op type to the *existing, unmodified* service function. `synced_operations`
dedups by client-generated `client_op_id`, so replaying the same action twice
(app restart mid-sync) can't double-apply. `orders.update` additionally does an
optimistic-concurrency check: the client sends the `updated_at` it last saw, and
a mismatch returns a `stale_version` conflict with the current server state
instead of silently overwriting someone else's edit.

**Conflicts / rejections** surface in `tablet/app/(main)/sync-review.tsx` with
plain-language messages and Retry / Discard. Nothing is silently dropped.

## Done

- Backend: migration `0014_offline_sync`, `SyncedOperation` model, schemas,
  dispatcher with all 10 ops registered (orders ×7, clock in/out, task done),
  `POST /sync/replay` route, `OrderOut.updated_at` exposed. Covered by
  `tests/test_sync.py` (dedup, idempotency conflict, CAS conflict, permission
  gating, inactive actor, unknown op, task ownership, batch continues past a
  failure) plus a wire-format test in `tests/test_orders.py`.
- Backend: production config validation — refuses to boot when `BOS_ENV` is
  prod/production with a dev JWT secret, a short secret, a non-Postgres URL, or
  localhost CORS origins.
- Tablet: connectivity tri-state + manual toggle, persisted read cache,
  Production/Deliveries readable offline, outbox + flush + Sync Review, and all
  in-scope screens wired through `useOfflineMutation`.
- Tablet: `__tests__/outbox.test.ts` (8 real tests — persistence, status
  filtering, targeted update/remove, subscriber notifications, concurrent-write
  serialization) and `__tests__/dates.test.ts`.

## Remaining

Neither of these blocks use; the feature is live on the shop floor.

1. **Auth expiry during a long offline stretch.** Any 401 currently calls
   `logout()`, which drops to the roster screen. The outbox survives structurally
   (different storage key), but the UX is bad: a tablet offline past its 12h JWT
   forces a full re-login before it can flush. Wanted: treat `token_expired`
   separately and prompt for a PIN in place, then resume the flush.
2. **`operations.ts` has no unit tests.** The jest config can't import anything
   that pulls in `expo-constants` (ESM syntax error), and `operations.ts` imports
   `endpoints.ts` → `client.ts` → `expo-constants`. Fixing this properly means
   adding real jest/babel config for RN+Expo. The CAS wiring there is currently
   protected by types and by the backend tests, not by a tablet unit test.
3. **The two-tablet conflict case is still untested.** The single-tablet round
   trip is confirmed working on real hardware. What has *not* been exercised is
   two tablets editing the same order while both offline, which is what the
   Sync Review screen and the optimistic-concurrency check exist for. Worth
   trying deliberately once both tablets are on 1.1.0.

### Done
- ~~Requires a full `eas build`, not an OTA~~ — shipped as v1.1.0 / versionCode 4.
- ~~Never run on a real device~~ — confirmed working by the owner, 2026-08-30.

## Shipping only part of this tree

To deploy an unrelated fix without dragging the offline work along (this is how
the needed-for date fix went out):

```bash
git status --porcelain > /tmp/before.txt && git diff > /tmp/before.diff
git stash push -u -m "offline WIP"
# apply ONLY the isolated change, then:
grep -rn "netinfo\|offline/\|OutboxProvider" tablet/src tablet/app   # must be empty
cd tablet && npx tsc --noEmit && npx jest
npx eas-cli update --branch production --platform android -m "..."
# restore
git checkout -- <files you touched> && git stash pop
git status --porcelain > /tmp/after.txt && diff /tmp/before.txt /tmp/after.txt
```

The grep is the important step: it proves no native/unfinished code is in the
bundle before it reaches the tablets.
