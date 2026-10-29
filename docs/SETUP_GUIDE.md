# Budget App Setup Guide

This guide walks you through setting up the Budget App from scratch.

## Prerequisites

- ✅ Node.js v18+ installed
- ✅ Git installed
- ✅ Code editor (VS Code recommended)

## Self-hosted (local Postgres)

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
   docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -f /sql_scripts/supabase_feature_migration.sql
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

#### Category archiving upgrade

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

#### Optional: Split expenses schema

If you want the shared expense / partnership features, run [`sql_scripts/supabase_split_expenses.sql`](../sql_scripts/supabase_split_expenses.sql) after the main schema script.

This adds:

- `partnerships`
- `split_expenses`
- `get_partner_email(UUID)` RPC function

#### Optional: RLS audit and re-apply

If you want to verify or re-apply row-level security policies, run [`sql_scripts/supabase_rls_complete.sql`](../sql_scripts/supabase_rls_complete.sql) after the schema scripts.

Use this script when:

- you want a policy audit after setup
- you are fixing a broken or partially configured project
- you added the split-expense tables and want to re-check all policies together

#### Verify the database

After running the scripts:

1. Open **Table Editor** in Supabase
2. Confirm the core tables exist
3. If you ran the split-expense script, confirm `partnerships` and `split_expenses` also exist
4. Review the query results at the bottom of the script output to confirm RLS is enabled where expected

## Step 2: Local Project Setup

### 2.1 Install Dependencies

```bash
git clone https://github.com/SamGunvalson/budget-app.git
cd budget-app
npm install
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

You should see:

```
  VITE v5.x.x  ready in XXX ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Step 3: Verify Setup

### 3.1 Test Supabase Connection

The app will show a simple UI. If Supabase is configured correctly, you should be able to:

- Sign up for an account
- Log in
- See no console errors related to Supabase
- Use the main budgeting features immediately after login if the main schema script was applied successfully

If you plan to use split expenses, open that page after login and confirm there are no missing-table errors.

### 3.2 Test Database

Open browser DevTools (F12) → Console. Try:

```javascript
// Should log the Supabase client
console.log(window.supabase);
```

If you see an object (not `undefined`), you're connected!

## Step 4: Default Data Setup (Optional)

### 4.1 Create Default Categories

After signing up/logging in, you can manually create categories, or run this SQL in Supabase SQL Editor:

```sql
-- Replace 'YOUR_USER_ID' with your actual user ID from auth.users table
INSERT INTO categories (user_id, name, type, color) VALUES
  ('YOUR_USER_ID', 'Groceries', 'needs', '#10B981'),
  ('YOUR_USER_ID', 'Rent/Mortgage', 'needs', '#EF4444'),
  ('YOUR_USER_ID', 'Utilities', 'needs', '#F59E0B'),
  ('YOUR_USER_ID', 'Transportation', 'needs', '#8B5CF6'),
  ('YOUR_USER_ID', 'Entertainment', 'wants', '#EC4899'),
  ('YOUR_USER_ID', 'Dining Out', 'wants', '#06B6D4'),
  ('YOUR_USER_ID', 'Emergency Fund', 'savings', '#14B8A6'),
  ('YOUR_USER_ID', 'Investments', 'savings', '#6366F1');
```

**To get your user ID:**

1. In Supabase dashboard, go to **Authentication** → **Users**
2. Find your email
3. Copy the UUID in the "ID" column

## Troubleshooting

### Build errors about missing modules

```bash
npm install
```

### "Module not found: recharts"

```bash
npm install recharts
```

### Supabase connection errors

1. Check `.env` file has correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
2. Restart dev server after changing `.env`
3. In Supabase dashboard → Settings → API, verify the keys match
4. Check browser console for specific error messages

### RLS Policy errors ("new row violates row-level security policy")

1. Make sure you're logged in
2. Re-run [`sql_scripts/supabase_rls_complete.sql`](../sql_scripts/supabase_rls_complete.sql)
3. In Supabase → Authentication → Policies, check each table has policies enabled
4. If you use split expenses, make sure you also ran [`sql_scripts/supabase_split_expenses.sql`](../sql_scripts/supabase_split_expenses.sql)
5. If split-expense delete/edit still fails with `"new row violates row-level security policy for table split_expenses"`, run [`sql_scripts/supabase_split_fix_rls.sql`](../sql_scripts/supabase_split_fix_rls.sql) to drop and recreate the split UPDATE/DELETE policies
6. If recurring confirmations created duplicate split rows, run [`sql_scripts/supabase_split_dedup.sql`](../sql_scripts/supabase_split_dedup.sql) to soft-delete duplicates and enforce one active split row per `transaction_id`

### Database tables not showing up

1. Go to Supabase → SQL Editor → History
2. Verify [`sql_scripts/supabase_schema_create.sql`](../sql_scripts/supabase_schema_create.sql) ran successfully
3. If you need split expenses, verify [`sql_scripts/supabase_split_expenses.sql`](../sql_scripts/supabase_split_expenses.sql) also ran successfully
4. Re-run the failed script

### Port 5173 already in use

Stop other Vite dev servers or use a different port:

```bash
npm run dev -- --port 5174
```

## Next Steps

Once setup is complete:

All phases are complete. See the root [README.md](../README.md) for the full feature list.

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

**Setup Version**: 1.1  
**Last Updated**: March 18, 2026
