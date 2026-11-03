# Budget App Setup Guide

This guide walks you through setting up the Budget App from scratch.

## Prerequisites

- ✅ Node.js 22.12+ installed for development (Node 22 in the dev container; Node 24 in CI)
- ✅ Git installed
- ✅ Code editor (VS Code recommended)

## Self-hosted local Postgres

This option runs PostgreSQL 16, PostgREST, the Fastify auth service, and the app's
Nginx frontend in Docker Compose. It does not require Supabase. Nginx serves plain
HTTP; do not expose it to an untrusted network without TLS.

Deployment requires only Docker Compose, `docker-compose.selfhost.yml`, and an
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
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d --pull always
   ```

3. Open `http://localhost:8085` (or the configured `APP_PORT`) and sign up for
   the first account. Then set `ALLOW_SIGNUP=false` in `.env.selfhost` and apply
   the setting by recreating the stack:

   ```bash
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d
   ```

   The auth service CLI can create accounts or reset passwords. It reads a new
   password from stdin when `--password` is omitted; reset-password also revokes
   existing refresh-token sessions:

   ```bash
   printf 'New password: '
   IFS= read -r -s NEW_PASSWORD
   printf '\n'
   printf '%s\n' "$NEW_PASSWORD" | docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost exec -T auth node src/cli.js reset-password user@example.com
   unset NEW_PASSWORD
   ```

4. Back up the database from the host. Treat the resulting SQL file as sensitive:

   ```bash
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost exec -T db pg_dump -U postgres -d postgres > budget-app-backup.sql
   ```

   Store backups securely and verify that you can restore them. The migration
   and cutover procedure from Supabase is documented in
   [`scripts/migrate-from-supabase/README.md`](../scripts/migrate-from-supabase/README.md).

5. **Updates:** Back up first and read the release's migration instructions.
   Set `BUDGET_IMAGE_TAG` to a matching published tag for all three Budget App
   images, or leave it at `latest` for the newest published build. Main-branch
   releases use tags such as `v1.2.3`; manually pushed semver tags also publish
   tags such as `1.2.3`. Use a tag present on all three images.

   ```bash
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost pull
   ```

   **Upgrading schema:** Postgres init scripts run only when the database volume
   is first created. They do not automatically apply new schema changes to an
   existing volume. Apply each future SQL migration manually with `psql`, in the
   documented order. The new database image includes the release's SQL files.
   Recreate only the database service to make those files available, keeping
   PostgreSQL 16 and the existing volume:

   ```bash
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d --no-deps --wait db
   # Example only: replace with the migration filename specified by the release.
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /sql_scripts/migrations/supabase_feature_migration.sql
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d
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

Paste `docker-compose.selfhost.yml` into your Compose Manager project and supply
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

Only the app joins the proxy network; auth, PostgREST, and the database stay on
the default network. If Caddy is the only entry point, remove the app's `ports:`
section; Caddy connects over Docker networking without publishing a host port.
Use the manager's pull/update and recreate operations for updates, with the
same backup and explicit schema-migration precautions described above.

### Building self-hosted images from source

For development or testing unpublished changes, use the optional build override
from a repository checkout:

```bash
docker compose -f docker-compose.selfhost.yml -f docker-compose.selfhost.build.yml --env-file .env.selfhost up -d --build
```

To run the deployment smoke test locally (requires Node.js 22+ and Docker),
build disposable test tags, then run:

```bash
BUDGET_IMAGE_TAG=selfhost-test docker compose -f docker-compose.selfhost.yml -f docker-compose.selfhost.build.yml --env-file .env.selfhost build
node --test scripts/test-selfhost.test.js
```

The test copies only the deployment Compose file into a temporary directory,
generates its own credentials, and uses an isolated project/volume. It checks
fresh initialization, transaction RLS, signup, authenticated writes, and login
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
VITE_BACKEND_MODE=local DEV_API_PROXY_TARGET=http://localhost:8085 npm run dev
```

The browser uses Vite's `/rest/v1` and `/auth/v1` paths. Alternatively,
`VITE_API_ORIGIN` selects a direct API origin when its CORS policy permits
the browser origin. The [Vite configuration](../vite.config.js) enables the
proxy only when `DEV_API_PROXY_TARGET` is set; if both are supplied,
`VITE_API_ORIGIN` takes precedence as its proxy target.

## Step 1: Supabase Setup (5-10 minutes)

### 1.1 Create Supabase Account

1. Go to [https://supabase.com](https://supabase.com)
2. Click "Start your project" / Sign up
3. Use GitHub/Google sign-in or email

### 1.2 Create New Project

1. Click "New Project"
2. Choose organization (create one if needed)
3. Fill in project details:
   - **Name**: `budget-app` (or your choice)
   - **Database Password**: Generate a strong password (save it!)
   - **Region**: Choose closest to you
   - **Pricing Plan**: Free tier is perfect for learning
4. Click "Create new project"
5. Wait 2-3 minutes for provisioning

### 1.3 Get API Credentials

1. In your Supabase dashboard, click **"Settings"** (gear icon, bottom left)
2. Click **"API"** in the sidebar
3. Copy these values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **Publishable key** (labeled "anon" in older UI - the long string under "Project API keys")
   - ⚠️ **Use publishable, NOT secret** - publishable is safe for client-side apps with RLS

### 1.4 Create Database Schema

Use the SQL files in [`sql_scripts/`](../sql_scripts/) instead of copying SQL out of [`DATA_MODEL.md`](./DATA_MODEL.md). The data model doc is the schema reference; the scripts are the source of truth for setup.

#### Required: Main app schema

1. In Supabase dashboard, click **"SQL Editor"**
2. Click **"New query"**
3. Open [`sql_scripts/supabase_schema_create.sql`](../sql_scripts/supabase_schema_create.sql)
4. Copy the full contents into the SQL Editor and run it

This creates the core app tables and their initial RLS policies:

- `categories`
- `user_preferences`
- `budget_plans`
- `budget_items`
- `accounts`
- `transactions`
- `recurring_templates`

#### Complete a fresh Supabase installation

The base script creates seven core tables, not the complete installation.
For the current frontend, run these additional scripts in order:

1. [`supabase_split_expenses.sql`](../sql_scripts/supabase_split_expenses.sql)
   creates partnerships, split expenses, and the partner-email RPC.
2. [`supabase_add_updated_at.sql`](../sql_scripts/supabase_add_updated_at.sql)
   supplies the remaining sync timestamps and update triggers.
3. [`supabase_category_archiving.sql`](../sql_scripts/supabase_category_archiving.sql)
   installs archive/restore and reference guards.
4. [`supabase_phase3_aggregations.sql`](../sql_scripts/supabase_phase3_aggregations.sql)
   installs account/report/year-picker RPCs and supporting indexes.
5. [`supabase_phase4_mutations.sql`](../sql_scripts/supabase_phase4_mutations.sql)
   installs batched writes and the closed-account insert guard.
6. [`supabase_rls_complete.sql`](../sql_scripts/supabase_rls_complete.sql)
   re-applies the complete policies after all referenced tables exist.

Using the split-expense UI is optional, but the complete RLS script references
its tables unconditionally. This sequence installs the full supported schema.
Do not run the local-only auth/role/grant scripts on Supabase. See the
[SQL setup guide](../sql_scripts/README.md) and
[historical migrations](../sql_scripts/migrations/README.md) for the separation
between current setup and existing-database upgrades. The base already includes
the recurring occurrence column, dedup constraint, and generation lookup index.

#### Category archiving upgrade

Use **Categories → Archive** to hide unused categories from new-entry lists
without changing historical transactions, budgets, or totals. All five types
are supported. Enable **Show archived** to restore one. Archiving is distinct
from deletion; archived names remain reserved.

Archiving requires a connection. Change or pause recurring schedules and
change/remove quick-entry templates that reference the category first.
Errors identify blockers. Linked recurring transfers also depend on the
`Account Transfer` companion category. Paused schedules cannot resume with
archived categories until those categories are restored or replaced.

Historical filters retain an Archived label, and existing transactions may
retain their archived category when edited. Saved budget allocations remain
editable, including filling other months of the same year. Budget copy/import
may explicitly carry archived categories forward; transaction CSV imports and
other new-entry choices exclude them. Historical data works offline and
restoration can queue for sync.

For both fresh and existing Supabase installations, run
[`supabase_add_updated_at.sql`](../sql_scripts/supabase_add_updated_at.sql)
if not already applied, then
[`supabase_category_archiving.sql`](../sql_scripts/supabase_category_archiving.sql)
in the SQL Editor before deploying the updated frontend. The latter is
idempotent: it adds `is_archived` for existing categories (default false),
installs the archive/restore RPC and reference guards, and notifies PostgREST
to reload its schema. Ownership RLS and historical records remain unchanged.

Fresh self-hosted databases apply it automatically through
[`local/apply_order.txt`](../sql_scripts/local/apply_order.txt).
Existing self-hosted volumes do **not** rerun initialization scripts. Back up
first, then apply the migration explicitly using the updated database image:

```bash
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /sql_scripts/supabase_category_archiving.sql
```

Existing volumes must already have the base schema and updated-at migration.
Do not rerun the base CREATE script on an existing database. The shared
archive migration also supplies the authenticated RPC EXECUTE grant; no new
local-only function or duplicate migration is necessary.

#### Existing databases and RLS repair

Back up first and use the [migration catalog](./DATA_MODEL.md#sql-migration-scripts)
to identify unapplied upgrades. Never rerun the base CREATE scripts on an
existing database. Old databases may need column migrations already folded
into today's base before applying archive, aggregation, or mutation scripts.

For legacy transaction policies, first apply
[`migrations/supabase_transactions_soft_delete_rls.sql`](../sql_scripts/migrations/supabase_transactions_soft_delete_rls.sql)
to install the soft-delete RPC and replace the broad transaction policy.

To verify or re-apply row-level security policies, run
[`supabase_rls_complete.sql`](../sql_scripts/supabase_rls_complete.sql)
after all schema prerequisites, including partnerships and split expenses.

Use this script when:

- you want a policy audit after setup
- you are fixing a broken or partially configured project
- you added the split-expense tables and want to re-check all policies together

#### Verify the database

After running the scripts:

1. Open **Table Editor** in Supabase
2. Confirm the core tables exist
3. Confirm `partnerships` and `split_expenses` also exist
4. Review the query results at the bottom of the script output to confirm RLS is enabled where expected

## Step 2: Local Project Setup

### 2.1 Install Dependencies

```bash
git clone https://github.com/SamGunvalson/budget-app.git
cd budget-app
npm ci
```

### 2.2 Configure Environment Variables

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` in your editor

3. Replace the placeholder values:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your_long_anon_key_here
   ```

**⚠️ IMPORTANT**: Never commit `.env` to Git (it's already in `.gitignore`)

### 2.3 Start Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Step 3: Verify Setup

### 3.1 Test Supabase Connection

The app will show a simple UI. If Supabase is configured correctly, you should be able to:

- Sign up for an account
- Log in
- See no console errors related to Supabase
- Use accounts, budgets, reports, and category management after completing the fresh-install sequence

Open Split Expenses and confirm there are no missing-table errors.

### 3.2 Test Database

Create an account and a transaction, edit it, and refresh the page to verify
persistence. Check the browser Network panel for successful authenticated
requests and the Supabase Table Editor for the saved rows. The app does not
expose a `window.supabase` connection probe.

## Step 4: Default Data Setup (Optional)

### 4.1 Create Default Categories

Create categories through **Categories** after signing in. This uses the
selected backend, ownership checks, and cache invalidation without maintaining
a second SQL seed list in documentation.

## Dev container

The [dev-container configuration](../.devcontainer/devcontainer.json) uses
Node 22. Install Docker Desktop and the VS Code Dev Containers extension,
configure `.env`, then open the repository and choose **Reopen in Container**.
Dependencies install automatically; run `npm run dev` at the repository root.
The container includes ESLint, Prettier, Tailwind CSS IntelliSense, GitLens,
and React snippet extensions.

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

## Docker deployment with Supabase

The [default Compose file](../docker-compose.yml) pulls the published frontend
image and injects Supabase configuration at runtime:

```bash
cp .env.example .env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
docker compose up -d --pull always
```

Open `http://<server-ip>:8085`. Use a trusted encrypted network such as Tailscale
or a TLS reverse proxy; do not expose public plaintext HTTP.

For an unpublished local frontend build:

```bash
docker build -t budget-app .
docker run --name budget-app-local --restart unless-stopped \
  -p 8085:8085 \
  -e BACKEND_MODE=supabase \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_ANON_KEY=your-public-key \
  budget-app
```

No Supabase build arguments are required. In Unraid's manual Docker UI,
select the published image or your local `budget-app` image, map host
8085 to **container 8085**, and supply the same runtime environment variables.

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

### Supabase connection errors

1. Check `.env` file has correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
2. Restart dev server after changing `.env`
3. In Supabase dashboard → Settings → API, verify the keys match
4. Check browser console for specific error messages

### RLS Policy errors ("new row violates row-level security policy")

1. Make sure you're logged in
2. Re-run [`sql_scripts/supabase_rls_complete.sql`](../sql_scripts/supabase_rls_complete.sql)
3. In Supabase → Authentication → Policies, check each table has policies enabled
4. Make sure the full fresh-install sequence or the required incremental upgrades were applied
5. If split-expense delete/edit still fails with `"new row violates row-level security policy for table split_expenses"`, run [`migrations/supabase_split_fix_rls.sql`](../sql_scripts/migrations/supabase_split_fix_rls.sql) to drop and recreate the split UPDATE/DELETE policies
6. If recurring confirmations created duplicate split rows, run [`migrations/supabase_split_dedup.sql`](../sql_scripts/migrations/supabase_split_dedup.sql) to soft-delete duplicates and enforce one active split row per `transaction_id`

### Database tables not showing up

1. Go to Supabase → SQL Editor → History
2. Verify [`sql_scripts/supabase_schema_create.sql`](../sql_scripts/supabase_schema_create.sql) ran successfully
3. Verify [`supabase_split_expenses.sql`](../sql_scripts/supabase_split_expenses.sql) also ran successfully
4. Inspect the error and current schema before retrying; CREATE scripts are not safely re-runnable

### Port 5173 already in use

Use a different port without interfering with another dev server:

```bash
npm run dev -- --port 5174
```

## Next Steps

See the [README](../README.md) for features and the
[documentation index](./QUICK_REFERENCE.md) for contributor references.

## Additional Resources

- [Supabase Docs](https://supabase.com/docs)
- [React Docs](https://react.dev)
- [Recharts Docs](https://recharts.org)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Vite Docs](https://vitejs.dev)

## Getting Help

- Check browser DevTools console for errors
- Check Supabase dashboard logs (Logs section)
- Review [`DATA_MODEL.md`](./DATA_MODEL.md) for schema reference
- Review the SQL files in [`sql_scripts/`](../sql_scripts/) for the actual setup scripts
- Ask AI with specific error messages and context

---

**Setup Version**: 2.0

**Last Updated**: November 2, 2026
