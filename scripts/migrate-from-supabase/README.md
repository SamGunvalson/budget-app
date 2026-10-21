# Migrate from Supabase to the self-hosted stack

One-shot copy of `auth.users` (id, lowercased email, bcrypt hash, timestamps) and every
`public` table from a Supabase project into the local Postgres. Users keep their existing
passwords. The source is only read, inside a `READ ONLY REPEATABLE READ` snapshot.

## What it does

1. Reads the table list from the **source** catalog, intersects it with the **target**, and
   orders it by the target's foreign keys (self-references handled). Only columns present in
   both are copied; mismatches are warned about.
2. Aborts if lowercasing emails would collide, or if any user has no password/email
   (see `--skip-passwordless`).
3. Refuses to run if the target `auth.users` or any public table has rows (unless `--truncate`).
4. In **one target transaction** with `session_replication_role = replica` (no triggers such as
   `assert_account_open` / `updated_at`, no FK checks) it `COPY`-streams every table, then resets sequences.
5. Verifies before committing: per-table row counts, `SUM` of integer money-like columns
   (`amount`, `*_cents`, `planned_amount`, `starting_balance`, ...) and an orphan check on every FK.
   Any mismatch rolls everything back and exits non-zero.

## Usage

```bash
cd scripts/migrate-from-supabase && npm install

export SOURCE_DATABASE_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres'
export TARGET_DATABASE_URL='postgresql://postgres:<pw>@localhost:5432/postgres'

node migrate.js --dry-run              # plan + source counts, writes nothing
node migrate.js                        # real run (target must be empty)
node migrate.js --truncate             # wipe target public tables + auth.users first
node migrate.js --skip-passwordless    # import users lacking a password with hash '!'
```

Flags `--source` / `--target` override the env vars. Connection strings and password hashes are never printed.
The target user must be a **superuser** (needed for `session_replication_role`).

Passwordless users (e.g. OAuth-only) cannot log in after migration. Reset them with the auth
service CLI: `echo 'newpass123' | DATABASE_URL=... npm run cli -- reset-password user@example.com`
(in `server/auth`). Users without an email are imported as `<id>@migrated.invalid`.

## Cutover procedure

1. **Sync pending offline changes first.** On every device, open the app while online and
   confirm the sync indicator is clear. Switching servers **wipes local offline data (Dexie) and the
   sync queue**, so anything unsynced will be lost.
2. **Stop writes.** Tell everyone to close the app (or pause the Supabase project) so the data is frozen.
3. Get the Supabase **direct** connection string: Project Settings → Database → Connection string.
   Use the direct or *session* pooler (port 5432). Do **not** use the transaction pooler (port 6543).
4. Start the local stack on a **fresh volume** (`docker-compose.selfhost.yml`), e.g.
   `docker compose -f docker-compose.selfhost.yml up -d db` and wait until it is healthy (init scripts in
   `sql_scripts/local/` create the schema and roles). Bring the other services up after the migration.
5. Run the migration against the db container. Pick one:
   - Temporarily publish the db port (e.g. `127.0.0.1:5432:5432`) and use
     `TARGET_DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/postgres`.
   - Or run the script in a throwaway container on the compose network:

     ```bash
     docker run --rm --network <compose_project>_default -v "$PWD":/app -w /app/scripts/migrate-from-supabase \
       -e SOURCE_DATABASE_URL -e TARGET_DATABASE_URL=postgresql://postgres:<pw>@db:5432/postgres \
       node:22-alpine sh -c "npm install --no-audit --no-fund && node migrate.js --dry-run && node migrate.js"
     ```

   Always run `--dry-run` first and check the counts.
6. Read the verification table: every row must say `OK` and `FK check ... 0 with orphans`. Re-run with
   `--truncate` if you need to repeat.
7. Start the whole stack and verify (login, balances, reports) against the new server.
8. On each device: **Server Setup** → point at the new server (local mode) → log in with the **existing
   password**. Email logins are case-insensitive from now on because emails are stored lowercased.
9. Remove the temporary published port, and keep the Supabase project untouched (read-only backup) for a while.

### Notes

- Pending partnership invites match `invited_email` against the JWT `email` claim. Emails in `auth.users` are
  lowercased, so make sure `partnerships.invited_email` values are lowercase too; a mixed-case invited email
  will no longer match its owner. Fix with
  `UPDATE partnerships SET invited_email = lower(invited_email) WHERE invited_email <> lower(invited_email);` after migrating.
- Old Supabase sessions/refresh tokens are not migrated; everyone logs in again.
- Supabase-only schemas (storage, realtime, auth identities, etc.) are not copied.
