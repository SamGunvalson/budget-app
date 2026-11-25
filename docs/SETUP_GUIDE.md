# Budget App Setup Guide

This guide walks you through setting up the Budget App from scratch.

## Prerequisites

- ✅ Node.js 22.12+ installed for development (Node 22 in the dev container; Node 24 in CI)
- ✅ Git installed
- ✅ Code editor (VS Code recommended)

## Self-hosted local Postgres

This option runs PostgreSQL 16, PostgREST, the Fastify auth service, and the app's
Nginx frontend in Docker Compose. Nginx serves plain
HTTP; do not expose it to an untrusted network without TLS.

Deployment requires only Docker Compose, `docker-compose.yml`, and an
environment file. Download the Compose file and `.env.selfhost.example` from the
same repository release; no Node.js, Git checkout, source build, or SQL bind mounts
are needed on the server. The app, auth service, and initialized PostgreSQL image
are published as `thewarguy/budget-app`, `thewarguy/budget-app-auth`, and
`thewarguy/budget-app-db`. PostgREST uses its official image.

1. Copy the example environment file and generate unique secrets:

   ```bash
   cp .env.selfhost.example .env.selfhost
   openssl rand -hex 32  # generate each of POSTGRES_PASSWORD, AUTHENTICATOR_PASSWORD, AUTH_ADMIN_PASSWORD
   openssl rand -base64 48  # generate JWT_SECRET (shared by PostgREST and auth)
   ```

   Put each generated value in `.env.selfhost`; do not commit that file. The
   database passwords are embedded in connection strings, so use the hex output
   for those values. `JWT_SECRET` must be at least 32 bytes. `APP_BIND` defaults
   to `0.0.0.0`; expose the plain-HTTP app only over a trusted encrypted network
   such as Tailscale, or set `APP_BIND=127.0.0.1` and place a TLS-terminating
   reverse proxy on the same host.

2. Pull the published images and start the stack:

   ```bash
   docker compose --env-file .env.selfhost up -d --pull always
   ```

3. Open `http://localhost:8085` (or the configured `APP_PORT`) and sign up for
   the first account. Then set `ALLOW_SIGNUP=false` in `.env.selfhost` and apply
   the setting by recreating the stack:

   ```bash
   docker compose --env-file .env.selfhost up -d
   ```

   The auth service CLI can create accounts or reset passwords. It reads a new
   password from stdin when `--password` is omitted; reset-password also revokes
   existing refresh-token sessions:

   ```bash
   printf 'New password: '
   IFS= read -r -s NEW_PASSWORD
   printf '\n'
   printf '%s\n' "$NEW_PASSWORD" | docker compose --env-file .env.selfhost exec -T auth node src/cli.js reset-password user@example.com
   unset NEW_PASSWORD
   ```

4. Back up the database from the host. Treat the resulting SQL file as sensitive:

   ```bash
   docker compose --env-file .env.selfhost exec -T db pg_dump -U postgres -d postgres > budget-app-backup.sql
   ```

   Store backups securely and verify that you can restore them.

5. **Updates:** Back up first and read the release's migration instructions.
   Set `BUDGET_IMAGE_TAG` to a matching published tag for all three Budget App
   images, or leave it at `latest` for the newest published build. Main-branch
   releases use tags such as `v1.2.3`; manually pushed semver tags also publish
   tags such as `1.2.3`. Use a tag present on all three images.

   ```bash
   docker compose --env-file .env.selfhost pull
   ```

   **Upgrading schema:** Postgres init scripts run only when the database volume
   is first created. They do not automatically apply new schema changes to an
   existing volume. Apply each future SQL migration manually with `psql`, in the
   documented order. The new database image includes the release's SQL files.
   Recreate only the database service to make those files available, keeping
   PostgreSQL 16 and the existing volume:

   ```bash
   docker compose --env-file .env.selfhost up -d --no-deps --wait db
   # Example only: replace with the migration filename specified by the release.
   docker compose --env-file .env.selfhost exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /sql_scripts/migrations/supabase_feature_migration.sql
   docker compose --env-file .env.selfhost up -d
   ```

   Follow release-specific maintenance/downtime instructions; do not apply the
   entire fresh-install initializer to an existing database. Pulling images
   alone does not migrate the schema, rotate database passwords, or upgrade
   PostgreSQL across major versions. Never use `down -v` on a database you want
   to keep. Preserve the Compose project name so the same data volume is used.
   See [`sql_scripts/local/apply_order.txt`](../sql_scripts/local/apply_order.txt)
   for the fresh-install order and [`sql_scripts/local/README.md`](../sql_scripts/local/README.md)
   for the local compatibility-shim details.

### Unraid Compose Manager and Caddy

Paste `docker-compose.yml` into your Compose Manager project and supply
the environment variables through its environment-file/settings support.
Compose automatically reads `.env`; `.env.selfhost` requires an explicit
`--env-file .env.selfhost` argument or equivalent manager configuration.
Do not add `build:` entries or local SQL mounts.

If Caddy runs in Docker on an existing external network named `proxynet`, add
this to the `budget-app` service:

```yaml
    networks: [proxynet, default]
```

Also add this top-level section:

```yaml
networks:
  proxynet:
    external: true
```

Keep Caddy on `proxynet` and use this upstream:

```caddyfile
budget.example.com {
    reverse_proxy budget-app:8085
}
```

Nginx overwrites `X-Forwarded-For` with the address of its direct peer so
clients cannot spoof the IP used for auth rate limits. Behind Caddy (or any
other reverse proxy) that peer is the proxy, so all users share one per-IP
rate-limit bucket unless you tell Nginx to trust it. To restore per-client
limits, mount a file at `/etc/nginx/snippets/real-ip.conf` in the `budget-app`
service containing only your proxy's address or subnet:

```nginx
set_real_ip_from 172.20.0.0/16;  # the proxynet subnet (or the proxy's IP)
real_ip_header X-Forwarded-For;
```

Never list a range that untrusted clients can connect from.

Only the app joins the proxy network; auth, PostgREST, and the database stay on
the default network. If Caddy is the only entry point, remove the app's `ports:`
section; Caddy connects over Docker networking without publishing a host port.
Use the manager's pull/update and recreate operations for updates, with the
same backup and explicit schema-migration precautions described above.

#### Applying a migration on Unraid

Run these from the Unraid web terminal (**>_** icon) or over SSH. Plain
`docker` commands avoid needing Compose Manager's env-file path.

1. Find the database container name. Compose Manager names it after the
   project, e.g. `budget-app-db-1`:

   ```bash
   docker ps --format '{{.Names}}' | grep -- '-db-'
   DB=budget-app-db-1   # replace with the name printed above
   ```

2. Back up to the array, not the container:

   ```bash
   docker exec "$DB" pg_dump -U postgres -d postgres > /mnt/user/backups/budget-$(date +%F).sql
   ```

3. Run the migration. Choose one source for the SQL file:

   - **Released version.** The images are published from `main`, so the file
     is already inside the DB image. Use Compose Manager's **Update Stack**
     button, which pulls and recreates every container, then immediately run
     the command below. Reports fail only until it finishes.

     ```bash
     docker exec -i "$DB" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
       -f /sql_scripts/migrations/supabase_report_as_of.sql
     ```

   - **Unreleased branch.** The running image does not contain the file yet.
     Copy the file from your checkout to the server, for example into
     `/mnt/user/appdata/budget-app/` over the SMB share, and pipe it in. This
     works with any image tag:

     ```bash
     docker exec -i "$DB" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
       < /mnt/user/appdata/budget-app/supabase_report_as_of.sql
     ```

   A successful run prints a run of `DROP FUNCTION` and `CREATE FUNCTION`
   lines and ends with `NOTIFY` and `COMMIT`. If any line says `ERROR`, the
   whole transaction rolled back and nothing changed.

4. For the unreleased-branch path, update the app container after the
   migration so the new frontend never runs against the old functions. The
   old frontend keeps working after the migration, because `p_as_of` is
   optional.

### Building self-hosted images from source

For development or testing unpublished changes, use the optional build override
from a repository checkout:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml --env-file .env.selfhost up -d --build
```

To run the deployment smoke test locally (requires Node.js 22+ and Docker),
build disposable test tags, then run:

```bash
BUDGET_IMAGE_TAG=selfhost-test docker compose -f docker-compose.yml -f docker-compose.build.yml --env-file .env.selfhost build
node --test scripts/test-selfhost.test.js
```

The test copies only the deployment Compose file into a temporary directory,
generates its own credentials, and uses an isolated project/volume. It checks
fresh initialization, transaction/recurring-cleanup RLS, signup, authenticated writes, and login
and data persistence after container recreation, then removes its own resources.
It never uses the development or production database volume.

The release workflow builds all three images for amd64 and arm64 with matching
tags. Before the first image-only deployment, a successful main/tag publish must
have pushed all three images. The Docker Hub publishing token must have push
access to all three repositories; create the additional repositories if needed
and make them public for unauthenticated pulls.

### Vite development against the self-hosted stack

Start the stack, then point Vite's same-origin API proxy at its Nginx service:

```bash
DEV_API_PROXY_TARGET=http://localhost:8085 npm run dev   # or set it in .env
```

The browser uses Vite's `/rest/v1` and `/auth/v1` paths. Alternatively,
`VITE_API_ORIGIN` selects a direct API origin when its CORS policy permits
the browser origin. The [Vite configuration](../vite.config.js) enables the
proxy only when `DEV_API_PROXY_TARGET` is set; if both are supplied,
`VITE_API_ORIGIN` takes precedence as its proxy target.

## Release upgrade notes

These notes apply to existing database volumes. Fresh volumes get every change
through [`local/apply_order.txt`](../sql_scripts/local/apply_order.txt). Back up
first, recreate `db` from the updated image, and never rerun the base CREATE
scripts on an existing database. Use the
[migration catalog](./DATA_MODEL.md#sql-migration-scripts) to identify
unapplied upgrades; on Unraid, see
[applying a migration on Unraid](#applying-a-migration-on-unraid).

### Category archiving

Use **Categories → Archive** to hide unused categories from new-entry lists
without changing historical transactions, budgets, or totals. Archiving requires
a connection; change or pause recurring schedules and quick-entry templates that
reference the category first. Existing volumes need
[`supabase_add_updated_at.sql`](../sql_scripts/supabase_add_updated_at.sql)
(if not already applied), then:

```bash
docker compose --env-file .env.selfhost exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /sql_scripts/supabase_category_archiving.sql
```

The script is idempotent, supplies the authenticated RPC EXECUTE grant, and
notifies PostgREST to reload its schema.

### Report "Include upcoming"

Reports pass `p_as_of` to `get_plan_vs_actual`, `get_plan_vs_actual_ytd`,
`get_monthly_spending_trend`, and `get_yearly_spending_trend`. Apply
[`migrations/supabase_report_as_of.sql`](../sql_scripts/migrations/supabase_report_as_of.sql)
**before** deploying the updated frontend, or report requests fail with a
missing function signature. It is transactional, changes no data, is safe to
rerun, and reloads the PostgREST schema itself.

```bash
docker compose --env-file .env.selfhost exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /sql_scripts/migrations/supabase_report_as_of.sql
```

To verify, `\df get_plan_vs_actual` in `psql` should list `p_as_of date`.

### RLS repair

If recurring edits fail while clearing projections with
`42501: new row violates row-level security policy for table "transactions"`,
apply the owner-scoped cleanup RPC:

```bash
docker compose --env-file .env.selfhost exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /sql_scripts/migrations/supabase_recurring_projection_cleanup.sql
```

For legacy transaction policies, first apply
[`migrations/supabase_transactions_soft_delete_rls.sql`](../sql_scripts/migrations/supabase_transactions_soft_delete_rls.sql).
To verify or re-apply all policies, run
[`supabase_rls_complete.sql`](../sql_scripts/supabase_rls_complete.sql)
after all schema prerequisites, including partnerships and split expenses.

## Dev container

The [dev-container configuration](../.devcontainer/devcontainer.json) uses
Node 22. Install Docker Desktop and the VS Code Dev Containers extension,
configure `.env` from `.env.example`, then open the repository and choose **Reopen in Container**.
Dependencies install automatically; run `npm run dev` at the repository root.
The container includes ESLint, Prettier, Tailwind CSS IntelliSense, Claude,
and React snippet extensions.

The container also runs its own Docker daemon (the `docker-in-docker` feature)
and installs `server/auth` dependencies, so the Docker-backed checks in
[validation](#validation) work inside it. The daemon's image cache is separate
from the host's and is lost on container rebuild. To run the deployment smoke
test as CI does:

```bash
docker build -t thewarguy/budget-app-db:selfhost-test ./sql_scripts
docker build -t thewarguy/budget-app-auth:selfhost-test ./server/auth
docker build -t thewarguy/budget-app:selfhost-test .
node --test scripts/test-selfhost.test.js
npm --prefix server/auth test
```

### Windows troubleshooting

If startup fails with `accessing specified distro mount service` and a missing
`ubuntu.sock` (or another WSL distro socket), inspect the Dev Containers log
for an automatically added `wayland-0` bind mount.

This web app does not require Linux GUI forwarding. In **VS Code User settings**
(not workspace settings or `devcontainer.json`), disable **Dev Containers: Mount
Wayland Socket**, or add:

```json
"dev.containers.mountWaylandSocket": false
```

Then reopen the container. This affects all dev containers in the current
VS Code profile. If other containers need Linux GUI apps, instead enable
Docker Desktop WSL integration for the distro named in the failing mount
and restart Docker Desktop.

## Validation

From the repository root:

```bash
npm run lint
node --test scripts/category-archive.test.js scripts/helpers.test.js
npm run build
```

- [Auth-service tests](../server/auth/README.md#tests): `npm --prefix server/auth test`;
  require its installed dependencies and an isolated PostgreSQL database or Docker.
- [Deployment smoke test](#building-self-hosted-images-from-source):
  `node --test scripts/test-selfhost.test.js`; requires matching disposable image
  tags and Docker. Never point it at a live database.
- [Transaction RLS regression checks](../sql_scripts/local/README.md):
  run only against a disposable local database.
- SQL layout/initializer path checks: `node --test scripts/sql-layout.test.js`;
  these use a mock `psql` to verify script ordering and fail-fast behavior, not
  SQL execution. Run the deployment/RLS checks with Docker for database validation.
- Recurring cleanup service regressions:
  `node --experimental-vm-modules --test scripts/recurring-cleanup.test.js`;
  these mock backend calls to verify RPC scopes, lifecycle ordering, and errors.
- [Android checks](./android-app.md#device-smoke-checks): use the native build
  workflow and test offline/auth transitions on a device before release.

Run the smallest relevant checks for a change. Documentation-only changes
need local-link/anchor verification, not a native or database rebuild.

## Troubleshooting

### Build errors about missing modules

```bash
npm ci
```

Restore the declared dependency tree rather than installing individual missing
packages or externalizing runtime imports.

### Connection errors

1. Confirm the stack is up: `docker compose --env-file .env.selfhost ps`
2. Check `curl http://localhost:8085/auth/v1/health` returns `{"ok":true}`
3. For `npm run dev`, check `.env` has `DEV_API_PROXY_TARGET` (or `VITE_API_ORIGIN`) and restart Vite after changing it
4. Check the auth and PostgREST container logs and the browser console

### RLS Policy errors ("new row violates row-level security policy")

1. Make sure you're logged in
2. If editing a recurring template fails on a `PATCH` to `transactions`, check that the app is not requesting returned rows from the soft-delete operation: the SELECT policy hides rows after `deleted_at` is set. Use an app version that updates without returning those rows. For other transaction RLS failures, existing databases may need [`migrations/supabase_transactions_soft_delete_rls.sql`](../sql_scripts/migrations/supabase_transactions_soft_delete_rls.sql) followed by [`sql_scripts/supabase_rls_complete.sql`](../sql_scripts/supabase_rls_complete.sql); see the [migration guide](../sql_scripts/migrations/README.md#applying-upgrades) for the local Docker command. Do not rerun the fresh-install initializer on an existing database.
3. In `psql`, check `\dp` / `pg_policies` shows policies on each table
4. Make sure the full fresh-install sequence or the required incremental upgrades were applied
5. If split-expense delete/edit still fails with `"new row violates row-level security policy for table split_expenses"`, run [`migrations/supabase_split_fix_rls.sql`](../sql_scripts/migrations/supabase_split_fix_rls.sql) to drop and recreate the split UPDATE/DELETE policies
6. If recurring confirmations created duplicate split rows, run [`migrations/supabase_split_dedup.sql`](../sql_scripts/migrations/supabase_split_dedup.sql) to soft-delete duplicates and enforce one active split row per `transaction_id`

### Database tables not showing up

1. Check the `db` container logs from first start; the initializer runs only on an empty volume
2. In `psql`, run `\dt public.*` and confirm the core, `partnerships`, and `split_expenses` tables exist
3. Inspect the error and current schema before retrying; CREATE scripts are not safely re-runnable

### Port 5173 already in use

Use a different port without interfering with another dev server:

```bash
npm run dev -- --port 5174
```

## Next Steps

See the [README](../README.md) for features and the
[documentation index](./QUICK_REFERENCE.md) for contributor references.

## Additional Resources

- [PostgREST Docs](https://docs.postgrest.org)
- [React Docs](https://react.dev)
- [Recharts Docs](https://recharts.org)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Vite Docs](https://vitejs.dev)

## Getting Help

- Check browser DevTools console for errors
- Check container logs: `docker compose --env-file .env.selfhost logs auth postgrest db`
- Review [`DATA_MODEL.md`](./DATA_MODEL.md) for schema reference
- Review the SQL files in [`sql_scripts/`](../sql_scripts/) for the actual setup scripts
- Ask AI with specific error messages and context

---

**Setup Version**: 3.0

**Last Updated**: November 25, 2026
