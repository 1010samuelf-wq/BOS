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

## Off-site copies (nightly `pg_dump`)

Volume snapshots live on Fly, next to the database they protect. If the Fly
account, org or region is lost, so are they. `.github/workflows/backup.yml`
keeps a second copy somewhere else:

| | |
|---|---|
| What | `pg_dump --format=custom` of `just_cake_bakery`, compressed |
| Where | An S3-compatible bucket outside Fly (Backblaze B2 or Cloudflare R2), under `postgres/` |
| Name | `just_cake_bakery-2026-10-20T0717Z.dump` (UTC date and time of the dump) |
| Schedule | Every night at 07:17 UTC; also runnable by hand (Actions → Backup → Run workflow) |
| Retention | **30 days**, never fewer than the 7 newest copies |
| Checks | The dump must contain data for `orders`, `order_items`, `order_payments`, `users` and `products`, and the uploaded size must match |
| Failure | The run goes red and GitHub emails you (see step 6 below) |

The same workflow also checks the **Postgres volume is under 80% full** and
fails (so emails) when it isn't — see "Disk space" below.

The repository is public and so are the workflow's logs. The workflow never
prints data or credentials, and the dump is never attached to the run. Keep it
that way.

### One-time setup

Set these up once, then do the first run by hand.

**1. A read-only database user for backups.** Better than giving GitHub the
superuser password: if it ever leaked, it can read but not change anything.

```bash
flyctl postgres connect -a just-cake-bakery-db -d just_cake_bakery
```

then, at the `just_cake_bakery=#` prompt (choose a long random password and
keep it for step 5):

```sql
CREATE ROLE bos_backup LOGIN PASSWORD 'paste-a-long-random-password-here';
GRANT pg_read_all_data TO bos_backup;
\q
```

**2. A bucket outside Fly.** Pick one:

- **Backblaze B2** — <https://www.backblaze.com/sign-up/cloud-storage>
  1. Buckets → *Create a Bucket*. Name e.g. `justcake-db-backups`, Files in
     Bucket: **Private**, Default Encryption: **Enable**, Object Lock: off.
  2. On the new bucket, *Lifecycle Settings* → **Keep only the last version of
     the file**. (B2 keeps "deleted" files as hidden versions otherwise, and the
     30-day pruning would never free anything.)
  3. Note the bucket's **Endpoint**, shown on the bucket card, e.g.
     `s3.us-east-005.backblazeb2.com`. The region is the middle part:
     `us-east-005`.
- **Cloudflare R2** — Cloudflare dashboard → R2
  1. *Create bucket*, name e.g. `justcake-db-backups`, location Automatic.
     R2 buckets are private and encrypted at rest by default.
  2. Note your **Account ID** (R2 overview page, right side). The endpoint is
     `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, region `auto`.

**3. A key that can only reach that bucket.**

- **B2:** Application Keys → *Add a New Application Key*. Name `github-backup`,
  *Allow access to Bucket(s)*: only `justcake-db-backups`, Type of Access:
  **Read and Write**. Copy the **keyID** and **applicationKey** now — the key
  is shown once.
- **R2:** R2 → *Manage R2 API Tokens* → *Create API token*. Permissions:
  **Object Read & Write**, *Specify bucket*: only `justcake-db-backups`. Copy the
  **Access Key ID** and **Secret Access Key** — shown once.

**4. The Fly token.** The workflow reuses the deploy workflow's
`FLY_API_TOKEN` secret, which must be able to reach `just-cake-bakery-db` (for
the tunnel and the disk check). If the first run fails at "Open a tunnel to the
database" with an authorization error, that token only covers the API app.
Make an org-wide one and replace the secret with it — it deploys too:

```bash
flyctl tokens create org -x 8760h     # valid one year; put a renewal date in your calendar
```

**5. The GitHub secrets.** github.com/1010samuelf-wq/BOS → Settings →
Secrets and variables → Actions → *New repository secret*, one at a time:

| Secret | Value |
|---|---|
| `BACKUP_PG_PASSWORD` | the `bos_backup` password from step 1 |
| `BACKUP_S3_BUCKET` | `justcake-db-backups` (the name only, no `s3://`) |
| `BACKUP_S3_ENDPOINT` | B2: `https://s3.us-east-005.backblazeb2.com` · R2: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `BACKUP_S3_REGION` | B2: `us-east-005` (from the endpoint) · R2: `auto` |
| `BACKUP_S3_ACCESS_KEY_ID` | B2 keyID · R2 Access Key ID |
| `BACKUP_S3_SECRET_ACCESS_KEY` | B2 applicationKey · R2 Secret Access Key |
| `FLY_API_TOKEN` | already there for deploys (see step 4) |

**6. Get emailed when it fails.** github.com → your avatar → Settings →
Notifications → *System* → **Actions** → tick **Email** and **Only notify for
failed workflows**. GitHub sends a scheduled workflow's failures to whoever
last changed its `cron:` line — this repository's pushes are yours, so that is
you.

**7. First run.** Actions → **Backup** → *Run workflow*. Both jobs should go
green; the run's summary page shows the file name, its size, the table count
and the disk usage. Then look in the bucket for `postgres/just_cake_bakery-….dump`.

One GitHub quirk: in a public repository, scheduled workflows are switched off
after **60 days with no commits**. GitHub emails a warning first; re-enable it
from the Actions tab (or push anything).

## Restoring from an off-site copy

Needs, on any computer: `flyctl`, PostgreSQL client tools version **17**
(`pg_restore`, `psql`), and the AWS CLI (`aws`) — or just download the file
from the B2/R2 web console instead of step 1.

1. **Download a dump.**
   ```bash
   export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_DEFAULT_REGION=…   # as in the secrets
   aws s3 ls s3://justcake-db-backups/postgres/ --endpoint-url https://…
   aws s3 cp s3://justcake-db-backups/postgres/just_cake_bakery-2026-10-20T0717Z.dump . \
     --endpoint-url https://…
   pg_restore --list just_cake_bakery-2026-10-20T0717Z.dump | grep -c "TABLE DATA"   # ~30
   ```

2. **Make an empty database to restore into.** For the drill, a throwaway
   cluster (destroy it afterwards, it bills):
   ```bash
   flyctl postgres create --name jc-restore-test --region yyz --org personal \
     --initial-cluster-size 1 --volume-size 1 --vm-size shared-cpu-1x
   flyctl postgres connect -a jc-restore-test
   ```
   and at the prompt: `CREATE DATABASE just_cake_bakery;` then `\q`.
   For a real recovery, use a new cluster created the same way (named e.g.
   `just-cake-bakery-db2`) with `--volume-size` at least as big as the old one.

3. **Restore through a tunnel.** In one terminal:
   ```bash
   flyctl proxy 15432:5432 -a jc-restore-test
   ```
   In another (password is the one `postgres create` printed):
   ```bash
   PGPASSWORD=… pg_restore -h 127.0.0.1 -p 15432 -U postgres -d just_cake_bakery \
     --no-owner --no-privileges --exit-on-error just_cake_bakery-2026-10-20T0717Z.dump
   PGPASSWORD=… psql -h 127.0.0.1 -p 15432 -U postgres -d just_cake_bakery -At \
     -c "select 'orders='||(select count(*) from orders)||' users='||(select count(*) from users)||' alembic='||(select version_num from alembic_version)"
   ```
   The counts should match the dashboard as of the dump's date, and `alembic`
   should name the newest file in `alembic/versions/`.

4. **For a real recovery, point the API at it** exactly as in "Recovering for
   real" below (`BOS_DATABASE_URL` with the new app's name and password), then
   check `/api/v1/health`. For the drill, `flyctl apps destroy jc-restore-test --yes`
   and add a line to the restore log.

**What you lose:** at most a day — whatever happened after the night's dump.

## Disk space

The `disk` job runs `df` on the database machine every night and fails when
`/data` is **80%** full or more. A full volume stops every write — no orders, no
clock-ins — so extend it when the alert comes, not when it's at 99%:

```bash
flyctl volumes list -a just-cake-bakery-db            # note the volume id and size
flyctl volumes extend vol_v3gzlopp00xwlw14 -a just-cake-bakery-db --size 3   # new size in GB
```

Extending is online and can't be undone (volumes only grow). The machine may
need a restart for Postgres to see the space: `flyctl machine restart -a just-cake-bakery-db`.

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

If Fly itself is the problem, restore from the off-site copy instead (above).

**Expect to lose up to a day.** Snapshots are daily, so a failure at 4pm loses
everything since that morning's snapshot. That is a deliberate trade-off for a
shop this size, not an oversight — closing the gap means continuous archiving
(Fly Managed Postgres, or WAL shipping to object storage), which is a bigger
piece of work. Revisit if a lost day of orders ever stops being survivable.

## Restore log

| Date | Snapshot | Result |
|---|---|---|
| 2026-08-30 | `vs_okyzQlzjoDKKfgNLwe08N1v` (23h old) | **Passed.** Restored to `jc-restore-test`; cluster healthy, `just_cake_bakery` present with 32 orders, 66 order items, 6 users, 70 products, 1 expense, $545.00 paid revenue; newest order 2026-08-24 (Weiss catering). Throwaway destroyed; production untouched. |
