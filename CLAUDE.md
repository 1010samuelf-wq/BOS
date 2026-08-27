# Just Cake — Bakery Operations System (BOS)

Operations platform for a working kosher bakery: order taking, a tablet POS, an
admin web dashboard, a public ordering site, plus recipe costing, production
planning, payroll hours and a simple AP/AR ledger.

**The backend is the single source of truth.** Every client talks to the same
API. Read `docs/SPEC.md` for the product spec and `docs/PERMISSIONS.md` for the
role/section model.

## Layout

```
app/          FastAPI backend — models, schemas, services, api/v1 routers
alembic/      migrations
tests/        pytest suite (SQLite in-memory by default)
web/          admin dashboard (React + Vite + TanStack Query)  -> just-cake-dashboard.fly.dev
tablet/       tablet POS (Expo / React Native, expo-router)     -> EAS OTA channel "production"
menu/         public ordering site (React + Vite)               -> justcakeskosher.com
docs/         spec, deployment, permissions, in-flight handoffs
```

## Commands

```bash
# backend  (venv at ./.venv, Python 3.14)
source .venv/Scripts/activate      # Git Bash on Windows
python -m pytest                   # full suite
alembic upgrade head
python dev_server.py               # SQLite dev API on :8000, auto-schema + seeds admin

# web
cd web && npm install && npx tsc --noEmit && npm run dev     # :5173

# tablet
cd tablet && npm install && npx tsc --noEmit && npx jest
```

There is **no browser-based way to view the tablet UI** in this project. Tablet
changes are verified with `tsc` + `jest` + a real device. Don't hunt for a
preview harness; there isn't one.

## Deploying

| Target | App | How |
|---|---|---|
| Backend | `just-cake-bakery` | `flyctl deploy --remote-only --depot=false` from repo root |
| Dashboard | `just-cake-dashboard` | build `dist/` first (below), then same flyctl command from `web/` |
| Menu | `just-cake-menu` | same pattern from `menu/` |
| Tablet (JS only) | EAS | `npx eas-cli update --branch production --platform android -m "..."` |
| Tablet (native dep added) | EAS | full `eas build` — an OTA **cannot** add a native module |

Two deploy landmines, both of which have bitten:

1. **`web/Dockerfile` ships a *prebuilt* `dist/`** — `flyctl deploy` does not
   build the frontend. Always run this first, or you silently ship a stale bundle:
   ```bash
   cd web && VITE_API_URL=https://just-cake-bakery.fly.dev npm run build
   ```
   Then confirm: `dist/` timestamp is fresh, it contains a marker string from your
   change, and it contains no `localhost:8000`.
2. **Never OTA the tablet from a dirty tree.** `eas update` bundles the *whole*
   current working directory. If unfinished work (especially anything importing a
   native module the installed binary lacks) is present, the tablets crash on
   launch. Isolate the change first — see the git-stash recipe in
   `docs/OFFLINE_HANDOFF.md`.

   The offline work is now **committed on `main`**, so stashing no longer
   isolates it. Branch from the commit *before* it (`b9b3f68^`), do the work
   there, OTA from that branch, then merge back — that is how the feedback
   button shipped. Prove the bundle is clean before publishing:
   ```bash
   grep -rn "netinfo\|offline/\|OutboxProvider" tablet/src tablet/app   # must be empty
   ```
   and after `eas update`, grep the exported bytecode as a second check:
   ```bash
   grep -a RNCNetInfo tablet/dist/_expo/static/js/android/*.hbc          # must be empty
   ```

`.github/workflows/deploy.yml` does all of this on GitHub Actions (manual
dispatch, gated on the backend suite) if you'd rather not deploy locally.

## Landmines

These are all real bugs that were shipped or nearly shipped. Read before editing.

- **Production refuses to boot on a bad config, and that check is newer than
  the running release.** `Settings.validate_for_runtime()` raises on a dev/short
  JWT secret, a non-Postgres URL, or *any* localhost entry in
  `BOS_CORS_ORIGINS`. Deploying this took the live API down for ~1 minute: prod's
  `BOS_CORS_ORIGINS` still had a `http://localhost:5173` entry from local
  testing, so every machine crashed on import while `release_command` (which
  doesn't build the app) had already passed. Before deploying the backend after
  a gap, check the secret actually holds only https origins — the value is not
  readable from `flyctl secrets list`, only its digest, so the cheap way to be
  sure is to set it explicitly. The recovery is `flyctl secrets set
  BOS_CORS_ORIGINS=...`, which restarts the machines with the new value.
- **Migrations must be idempotent-guarded.** `0001_initial` builds the whole
  schema from the *current* models via `create_all`, so on a fresh DB it also
  creates columns added by later revisions. Every migration after `0001` must
  check `inspect(bind)` and return early if the table/column already exists, and
  skip FK-adds on SQLite. Otherwise `alembic upgrade head` breaks on fresh DBs.
- **Migration seeds must cast enums explicitly on Postgres.** A bound VARCHAR
  does not implicitly cast to a native enum (`DatatypeMismatch`); SQLite hides this.
- **`needed_for_date` is a wall-clock business value, not an instant.** The
  backend buckets Production/Deliveries/order filters by its UTC calendar day, and
  `src/order/dates.ts` (mirrored in `web/` and `tablet/`) parses it by reading the
  date/time components verbatim and *ignoring* any `Z`/offset. Do not "fix" this
  to a timezone conversion: Postgres returns this column tz-aware while the SQLite
  dev DB returns it naive, so converting makes a date-only order render a day
  earlier in production while looking fine in dev. `tablet/__tests__/dates.test.ts`
  locks this down.
- **Use `utc_today()` / `utcnow()` (`app/models/base.py`), never `date.today()`**
  for any "today" default — local dates misfile the business day near midnight.
- **`orders.idempotency_key` requires `min_length=8`.** Short keys in test
  payloads return 400 and you get a confusing `KeyError` on `["id"]`.
- **Pydantic partial updates need `exclude_unset=True`.** `update_order` only
  touches fields the client actually sent; dumping the whole model blanks the rest
  of the order. This shipped once as a real bug.
- **Stock is advisory and may go negative** — a sale never blocks. Because every
  order deducts stock at creation, the production report's `to_bake` is `-in_stock`,
  *not* `needed - in_stock` (that double-counts).
- **Reports are cash-basis** — revenue/COGS count only paid orders; labor counts
  only paid-out shifts.
- **Logging `extra=` must not use reserved keys** (`message`, `asctime`) — stdlib
  logging raises `KeyError`. Prefix them (`notif_message`).
- **Realtime is push-only and coarse.** `broadcaster.publish` emits
  `orders_changed` / `stock_changed` / `notification` / `inquiry_created`; clients
  refetch. There is no "changes since" endpoint. `publish` no-ops until the app
  lifespan sets the loop, so it's inert in HTTP unit tests — WS tests need
  `with TestClient(app) as c:`.
- **Test fixtures** (`tests/conftest.py`): `client` is an authenticated admin,
  `make_user(name, role)` returns `(id, token, authed_client)`, `anon_client` has
  no token. Compare money as `Decimal`, not strings.

## Working agreements

- Ship in reviewable phases; verify before claiming done. Run the suites and,
  where it's user-visible, check it live — don't report a feature complete on the
  strength of code that merely compiles.
- Tests must be able to fail. A test asserting a hand-built literal against itself
  is worse than no test (this has happened here).
- The GitHub repo is **public** — never commit secrets, PINs, tokens, or personal
  contact details.
- Production is a live shop. Don't create junk data in the prod DB to test; use
  the local SQLite dev server instead.
