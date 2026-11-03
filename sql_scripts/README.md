# Database setup scripts

Top-level SQL files are the **current setup**. [`migrations/`](./migrations/)
contains historical upgrades and repairs for existing databases; their effects
are already represented in the current setup scripts.

## Fresh Supabase database

Run these in order as the database owner in the Supabase SQL Editor:

1. [supabase_schema_create.sql](./supabase_schema_create.sql) - seven core tables,
   indexes, initial policies, and transaction soft-delete RPC.
2. [supabase_split_expenses.sql](./supabase_split_expenses.sql) - partnerships,
   shared expenses, and partner-email RPC.
3. [supabase_add_updated_at.sql](./supabase_add_updated_at.sql) - remaining sync
   timestamps and update triggers.
4. [supabase_category_archiving.sql](./supabase_category_archiving.sql) - archive/
   restore RPC and reference guards.
5. [supabase_phase3_aggregations.sql](./supabase_phase3_aggregations.sql) - account/
   reporting RPCs and supporting indexes.
6. [supabase_phase4_mutations.sql](./supabase_phase4_mutations.sql) - batched
   writes and the closed-account insert guard.
7. [supabase_rls_complete.sql](./supabase_rls_complete.sql) - complete policy
   definitions, after all referenced tables exist.

The two base CREATE scripts are **not re-runnable**. Do not run all SQL files
alphabetically or recursively. Using the shared-expense UI is optional, but
the complete RLS script requires its tables.

## Fresh self-hosted database

The [local initializer](./local/init.sh) applies
[`local/apply_order.txt`](./local/apply_order.txt): local roles/auth compatibility
first, the same seven setup scripts, then grants. It does not run historical
migrations or the legacy local repair entrypoint.

The database [Docker image](./Dockerfile) includes setup, local, and historical
migration files. Initialization runs only on an empty volume. See the
[local SQL guide](./local/README.md) for roles/grants and the
[setup guide](../docs/SETUP_GUIDE.md#self-hosted-local-postgres) for deployment.

## Existing databases

Back up first. Apply only the release's required, unapplied upgrades in dependency
order; never rerun the fresh initializer or base CREATE scripts.
The [migration guide](./migrations/README.md) explains historical fixes and
manual application. Top-level feature/RPC scripts may also be required on an
older database: their location means they participate in fresh setup, not that
they are irrelevant to upgrades.

Column/constraint/index contracts and the complete script catalog live in the
[data model](../docs/DATA_MODEL.md). Keep the base/current feature SQL, upgrade
migrations, local apply order, image contents, and related documentation aligned
when changing database objects.
