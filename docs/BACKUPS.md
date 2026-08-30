# Backups & restore

The database is the only thing here that cannot be rebuilt from the repository.
Everything else — the API, both web apps, the tablet binary — can be redeployed
from source in minutes. Orders, customers, hours and the books cannot.

## What is in place

| | |
|---|---|
| What | Volume snapshots of the Fly Postgres app `just-cake-bakery-db` |
| Volume | `vol_v3gzlopp00xwlw14` (1 GB, encrypted, region `yyz`) |
| Schedule | Automatic, daily (`scheduled-snapshots: true`) |
| Retention | **30 days** (was 5 until 2026-08-30) |
| Restore tested | **2026-08-30** — see the log at the bottom |

Check the current settings and list what exists:

```bash
flyctl volumes list -a just-cake-bakery-db
flyctl volumes snapshots list vol_v3gzlopp00xwlw14 -a just-cake-bakery-db
```

To change retention (days) or turn the schedule on/off:

```bash
flyctl volumes update vol_v3gzlopp00xwlw14 -a just-cake-bakery-db \
  --snapshot-retention 30 --scheduled-snapshots=true
```

## Restore drill — run this about twice a year

**An untested backup is a belief, not a backup.** The drill below restores into
a *throwaway* database and never touches production, so it is safe to run on a
normal working day.

1. **Pick a snapshot.**
   ```bash
   flyctl volumes snapshots list vol_v3gzlopp00xwlw14 -a just-cake-bakery-db
   ```

2. **Restore it into a new, separate cluster.** This creates a real (billable)
   app — step 5 destroys it. Note the password it prints; you cannot see it again.
   ```bash
   flyctl postgres create --name jc-restore-test --region yyz --org personal \
     --snapshot-id vs_XXXXXXXX --initial-cluster-size 1 --volume-size 1 \
     --vm-size shared-cpu-1x
   ```

3. **Confirm the shop's data is actually there.** Row counts are the point of
   the drill — a cluster that boots with an empty database is a failed restore
   that looks like a success.
   ```bash
   flyctl ssh console -a jc-restore-test -C "env PGPASSWORD=<password> \
     psql -h 127.0.0.1 -p 5433 -U postgres -d just_cake_bakery -At \
     -c \"select 'orders='||(select count(*) from orders)||' users='||(select count(*) from users)\""
   ```
   Gotchas, both of which will waste ten minutes otherwise: Postgres listens on
   **5433**, not 5432 (5432 is the Fly proxy), and there is no unix socket, so
   `-h 127.0.0.1` is required.

4. **Compare against production.** The counts should be close to what the
   dashboard shows, allowing for whatever happened since the snapshot was taken.

5. **Destroy the throwaway.** Do not skip this — it bills until you do.
   ```bash
   flyctl apps destroy jc-restore-test --yes
   ```

6. **Record the result at the bottom of this file.**

## Recovering for real

If production is lost, the same restore produces a working cluster; then point
the API at it by updating `BOS_DATABASE_URL`:

```bash
flyctl secrets set BOS_DATABASE_URL="postgres://postgres:<password>@<new-app>.flycast:5432/just_cake_bakery" \
  -a just-cake-bakery
```

Setting the secret restarts the API. Check `/api/v1/health` reports
`"database": true` before telling staff it is back.

**Expect to lose up to a day.** Snapshots are daily, so a failure at 4pm loses
everything since that morning's snapshot. That is a deliberate trade-off for a
shop this size, not an oversight — closing the gap means continuous archiving
(Fly Managed Postgres, or WAL shipping to object storage), which is a bigger
piece of work. Revisit if a lost day of orders ever stops being survivable.

## Restore log

| Date | Snapshot | Result |
|---|---|---|
| 2026-08-30 | `vs_okyzQlzjoDKKfgNLwe08N1v` (23h old) | **Passed.** Restored to `jc-restore-test`; cluster healthy, `just_cake_bakery` present with 32 orders, 66 order items, 6 users, 70 products, 1 expense, $545.00 paid revenue; newest order 2026-08-24 (Weiss catering). Throwaway destroyed; production untouched. |
