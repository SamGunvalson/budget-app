# Budget App data model

This is the reference for database fields, relationships, and service contracts.
Executable SQL in [`sql_scripts/`](../sql_scripts/) defines installation and
migration behavior; do not copy schema-creation SQL from documentation.
See the [setup guide](./SETUP_GUIDE.md) for backend-specific installation and upgrades.

## Core principles

- Money is integer **cents** (`BIGINT`), never floating-point dollars.
- `DATE` values are `YYYY-MM-DD` strings; parse them as local dates in the UI.
  `TIMESTAMPTZ` values represent instants.
- Transactions and split expenses use `deleted_at`; active reads exclude deleted rows.
- RLS scopes financial data to the authenticated owner or partnership members.
- Database columns use snake_case. The frontend is JavaScript; SQL definitions
  and existing service return shapes are authoritative, not illustrative TypeScript interfaces.

## Database schema

Unless stated otherwise, public table IDs are UUID primary keys defaulting to
`uuid_generate_v4()`. Columns marked **required** are `NOT NULL`; a default
alone does not make a column non-nullable. `created_at` defaults to `now()`.

### Auth users (not a public `users` table)

Public ownership foreign keys reference **`auth.users(id)`**. Supabase manages
this table in Supabase mode. There is no app-defined public `users` table with
currency/timezone columns; UI preferences live in `user_preferences`.

In local mode, the [compatibility shim](../sql_scripts/local/README.md) supplies:

| Table | Fields |
| --- | --- |
| `auth.users` | `id UUID` PK, default `gen_random_uuid()`; required unique lowercase `email TEXT`; required `encrypted_password TEXT`; required `created_at`, `updated_at TIMESTAMPTZ` default `now()`; nullable `last_sign_in_at TIMESTAMPTZ` |
| `auth.refresh_tokens` | `id UUID` PK, default `gen_random_uuid()`; required `user_id UUID` FK to auth users with cascade delete; required unique `token_hash TEXT`; required `family_id UUID`; nullable `parent_id UUID`, `revoked_at TIMESTAMPTZ`, `user_agent TEXT`; required `expires_at TIMESTAMPTZ`; required `created_at TIMESTAMPTZ` default `now()` |

Refresh tokens are stored as hashes; `user_id` and `family_id` are indexed.
Only `auth_admin` (besides the owner) has auth-table CRUD. PostgREST exposes
only `public`, never auth tables. `anon` and `authenticated` have auth-schema
usage and helper execution, not auth-table access.

Local STABLE helpers `auth.uid()`, `auth.jwt()`, `auth.email()`, and `auth.role()`
read PostgREST JWT claims; `auth.uid()` supports both individual legacy claim
settings and `request.jwt.claims`. Missing/empty subject settings yield NULL.
`authenticator` is LOGIN NOINHERIT with membership in the two API roles.
Default public grants apply to objects created by the database owner.

### Table: `categories`

| Column | Type | Constraint/default |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `user_id` | UUID | Required; FK to `auth.users`, cascade delete |
| `name` | TEXT | Required |
| `type` | TEXT | Required; `income`, `needs`, `wants`, `savings`, `transfer` |
| `color` | VARCHAR(7) | Default `#3B82F6` |
| `icon` | TEXT | Nullable |
| `is_active` | BOOLEAN | Default true; false marks deletion |
| `is_archived` | BOOLEAN | Required; default false; retirement from new-entry choices |
| `sort_order` | INTEGER | Default 0 |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Default `now()`; added/trigger-maintained by sync migration |

The executable base has `UNIQUE(user_id, name, is_active)` (not a partial
unique index). Active rows have user and `(user_id, type, sort_order)` indexes.
RLS enforces ownership. Archiving preserves `is_active`, name reservation,
ownership, type, and historical references.

`set_category_archived(p_category_id UUID, p_archived BOOLEAN)` returns the
updated category row, requires authentication and an owned active category,
and is executable by `authenticated`. Archiving is online-only in the client;
restoration may queue offline.

The invoker `guard_category_archiving()` trigger serializes archive/reference
writes per owner with an advisory transaction lock. Category, recurring, and
quick-template preference writes reject archived categories referenced by live,
effectively unpaused schedules or saved quick templates. Group parent pause
state is respected; linked transfers also depend on the `Account Transfer`
companion category. Errors identify blockers.

The invoker `guard_transaction_category_archive()` trigger rejects new
transactions or category changes targeting an archived category, including
stale queued writes. Edits retaining the original category are allowed.
Historical filters retain archived categories. Saved budget allocations stay
editable across the same year; budget copy/import may retain archived categories.
See [archiving behavior](./SETUP_GUIDE.md#category-archiving-upgrade).

### Table: `user_preferences`

| Column | Type | Constraint/default |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `user_id` | UUID | Required; FK to `auth.users`, cascade delete |
| `preference_key` | TEXT | Required |
| `preference_value` | JSONB | Required; default `{}` |
| `created_at`, `updated_at` | TIMESTAMPTZ | Default `now()` |

Unique `(user_id, preference_key)`; index on `user_id`; owner-scoped RLS.
Preference values are application JSON, not separate database columns.
Examples include `type_group_order`, `favorite_accounts`, theme preferences,
`playground_scenarios`, and `quick_transaction_templates`.

Quick templates store label/description/payee, account/category IDs,
`is_income`, and optional `is_split`, `split_method`, `split_payer`,
`split_partner_share_pct`. Amount is entered when posting, not saved in the
template. See [quick transactions](../src/services/quickTransactions.js).

### Table: `budget_plans`

| Column | Type | Constraint/default |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `user_id` | UUID | Required; FK to `auth.users`, cascade delete |
| `month` | INT | Required; 1-12 |
| `year` | INT | Required; 2020-2100 |
| `name` | TEXT | Nullable |
| `total_income` | BIGINT | Default 0; expected income in cents |
| `created_at`, `updated_at` | TIMESTAMPTZ | Default `now()` |

Unique `(user_id, month, year)`; index `(user_id, year DESC, month DESC)`;
owner-scoped RLS.

### Table: `budget_items`

| Column | Type | Constraint/default |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `budget_plan_id` | UUID | Required; FK to `budget_plans`, cascade delete |
| `category_id` | UUID | Required; FK to `categories`, restrict delete |
| `planned_amount` | BIGINT | Required; >= 0 cents |
| `notes` | TEXT | Nullable |
| `updated_at` | TIMESTAMPTZ | Default `now()`; added/trigger-maintained by sync migration |

Unique `(budget_plan_id, category_id)`; indexes on each foreign key.
RLS checks parent budget-plan ownership, not a nonexistent `budget_items.user_id`.

### Table: `accounts`

| Column | Type | Constraint/default |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `user_id` | UUID | Required; FK to `auth.users`, cascade delete |
| `name` | TEXT | Required |
| `type` | TEXT | Required; `checking`, `savings`, `credit_card`, `retirement`, `brokerage`, `loan`, `mortgage` |
| `starting_balance` | BIGINT | Default 0 cents |
| `is_active` | BOOLEAN | Default true |
| `closed_at` | DATE | Nullable; NULL means open |
| `created_at`, `updated_at` | TIMESTAMPTZ | Default `now()` |

Active rows have a user index and unique `(user_id, name)` index.
RLS enforces ownership. Assets are checking, savings, retirement, brokerage;
liabilities are credit cards, loans, mortgages. Assets add income and subtract
expenses; liabilities add charges and subtract payments.

### Table: `transactions`

| Column | Type | Constraint/default |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `user_id` | UUID | Required; FK to `auth.users`, cascade delete |
| `account_id`, `category_id` | UUID | Required; respective FKs, restrict delete |
| `amount` | BIGINT | Required; nonzero cents |
| `description` | TEXT | Required |
| `payee` | TEXT | Nullable |
| `transaction_date` | DATE | Required |
| `is_income` | BOOLEAN | Default false; direction, not sufficient for classification |
| `transfer_group_id` | UUID | Nullable; links transfer legs |
| `status` | TEXT | Required; default `posted`; `projected`, `pending`, `posted` |
| `recurring_template_id` | UUID | Nullable; FK to recurring templates, set NULL on delete |
| `recurring_occurrence_date` | DATE | Nullable; original schedule date, unchanged by date edits |
| `created_at`, `updated_at` | TIMESTAMPTZ | Default `now()` |
| `deleted_at` | TIMESTAMPTZ | Nullable soft-delete timestamp |

Live-row indexes cover user/date, category, account, transfer group, and
user/month; there is also a user/status/date index. Recurring deduplication is
unique `(recurring_template_id, recurring_occurrence_date, account_id)` for
live rows with non-null template and occurrence. Account ID permits two transfer
legs for the same occurrence. The core base also includes the generation
lookup index; aggregation SQL adds account/date and user/category/date indexes.

Authenticated transaction SELECT/UPDATE `USING` requires ownership and
`deleted_at IS NULL`; UPDATE `WITH CHECK` checks ownership without the live-row
condition. INSERT checks ownership; DELETE preserves owner-only hard deletes.
The shared `soft_delete_transaction(txn_id UUID)` returns void and updates only
owned live rows under SECURITY DEFINER with fixed search path. Execution is
revoked from PUBLIC/anon and granted to authenticated. Repeat/missing-ID calls
do not change rows. Never restore the legacy permissive FOR ALL policy.

`soft_delete_recurring_projections(p_template_ids UUID[], p_transaction_ids UUID[],
p_from_date DATE)` returns the integer count of soft-deleted rows. It requires
authentication, a non-null local-date cutoff, and at least one non-null ID array.
When both arrays are supplied their filters intersect; an empty array matches
nothing. The fixed-search-path SECURITY DEFINER RPC only updates owned, live
recurring rows with projected/pending status on or after the cutoff, preserving
posted transactions and past rows. Execution is authenticated-only. Template
refresh uses template-family IDs (including inactive children); orphan cleanup
uses transaction IDs and tomorrow's cutoff. No transaction policies are widened.

### Table: `recurring_templates`

| Column | Type | Constraint/default |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `user_id` | UUID | Required; FK to `auth.users`, cascade delete |
| `account_id`, `category_id` | UUID | Required; respective FKs, restrict delete |
| `description` | TEXT | Required |
| `payee` | TEXT | Nullable |
| `amount` | BIGINT | Required cents |
| `is_income`, `is_transfer` | BOOLEAN | Default false |
| `to_account_id` | UUID | Nullable; FK to accounts, set NULL on delete |
| `to_amount` | BIGINT | Nullable; when set, destination must exist and amount > 0 |
| `frequency` | TEXT | Required; `weekly`, `biweekly`, `semi_monthly`, `monthly`, `quarterly`, `yearly`, `custom` |
| `day_of_month`, `day_of_month_2` | INT | Nullable; 1-31 when set |
| `day_of_week` | INT | Nullable; 0-6 when set |
| `custom_interval` | INT | Nullable; >= 1 when set |
| `custom_unit` | TEXT | Nullable; `days`, `weeks`, `months` |
| `start_date` | DATE | Required |
| `end_date`, `last_applied`, `projected_through` | DATE | Nullable |
| `group_id` | UUID | Nullable; FK to parent recurring template, cascade delete |
| `is_group_parent` | BOOLEAN | Default false |
| `group_order` | INT | Default 0 |
| `auto_confirm` | BOOLEAN | Required; default true |
| `is_paused` | BOOLEAN | Default false |
| `is_active` | BOOLEAN | Default true |
| `is_split` | BOOLEAN | Required; default false |
| `split_method` | TEXT | Nullable; `equal`, `full`, `custom` |
| `split_payer` | TEXT | Nullable; `me`, `partner` |
| `split_partner_share_pct` | INT | Nullable; 0-100 |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `updated_at` | TIMESTAMPTZ | Default `now()`; added/trigger-maintained by sync migration |

Transfers require `to_account_id`. Active user/group indexes and a destination
account index support lookup; RLS enforces ownership.

Group parents carry administrative defaults and the computed absolute net of
children for display; only children generate transactions. The database
`category_id` is required even for parent rows. Child account/payee/schedule
inheritance is implemented by the [recurring service](../src/services/recurring.js).
Split configuration applies to non-transfer, non-group templates.
`to_amount` supports asymmetric incoming transfer amounts.

### Table: `partnerships`

| Column | Type | Constraint/default |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `user_a_id` | UUID | Required inviter; FK to auth users, cascade delete |
| `user_b_id` | UUID | Nullable invitee; FK to auth users, cascade delete |
| `invited_email` | TEXT | Required |
| `status` | TEXT | Required; default `pending`; `pending`, `active`, `dissolved` |
| `created_at`, `updated_at` | TIMESTAMPTZ | Default `now()` |
| `user_a_seen_at`, `user_b_seen_at` | TIMESTAMPTZ | Nullable notification watermarks |

Unique active unordered user pair; unique pending inviter/email pair; at most
one active partnership per `user_a_id` and per `user_b_id` (partial unique
indexes). Indexes cover both members and pending invited email.
SELECT/UPDATE/DELETE permit members or pending invitees matching the JWT email;
INSERT requires the caller to be the inviter **and** the row to be a `pending`
invite with `user_b_id` NULL. UPDATE applies the same membership/invitation
condition in `WITH CHECK`.

The `trg_partnerships_guard` trigger (`partnerships_guard()`, fixed-search-path
SECURITY DEFINER, BEFORE INSERT OR UPDATE) enforces what RLS cannot:

- `id`, `user_a_id`, `invited_email`, and `created_at` are immutable;
- status may only go `pending` → `active` (by the invited user, whose JWT email
  matches `invited_email` and who becomes `user_b_id`) or `active` → `dissolved`;
  dissolved partnerships cannot be reactivated;
- `user_b_id` changes only as part of an accept;
- a pending invitee can accept but not otherwise update the row;
- a user may be in at most one active partnership in either role (raises
  `23505`).

Writes without an end-user identity (database owner, service role) skip the
transition rules but not the one-active-partnership rule.

`get_partner_email(p_partnership_id UUID)` returns the inviter email only to
`user_b` of that **active** partnership, otherwise NULL. It is a fixed-search-path
SECURITY DEFINER function reading auth users, with PUBLIC execution revoked and
authenticated execution granted. It is created by the split-expense base script,
not a separate partner-email migration.

### Table: `split_expenses`

| Column | Type | Constraint/default |
| --- | --- | --- |
| `id` | UUID | Primary key |
| `partnership_id` | UUID | Required; FK to partnerships, cascade delete |
| `paid_by_user_id` | UUID | Required; FK to auth users, cascade delete |
| `transaction_id` | UUID | Nullable; FK to transactions, set NULL on delete |
| `description` | TEXT | Required |
| `total_amount` | BIGINT | Required; > 0 cents |
| `payer_share`, `partner_share` | BIGINT | Required; >= 0 cents |
| `is_settlement` | BOOLEAN | Default false |
| `expense_date` | DATE | Required; default current date |
| `created_at` | TIMESTAMPTZ | Default `now()` |
| `deleted_at` | TIMESTAMPTZ | Nullable soft-delete timestamp |

Shares must sum to total amount. At most one live row per non-null transaction ID.
Live-row indexes cover partnership/date, payer, and transaction.
RLS scopes operations through partnership membership; inserts require an active
partnership. INSERT and UPDATE `WITH CHECK` also require `paid_by_user_id` to be
a member of the partnership, and INSERT requires a non-null `transaction_id` to
reference one of the caller's own transactions. The `trg_split_expenses_guard`
trigger (`split_expenses_guard()`, BEFORE UPDATE) freezes `partnership_id` and
`transaction_id` for end users (clearing `transaction_id` stays allowed).
SELECT/UPDATE `USING` excludes
deleted rows; UPDATE `WITH CHECK` intentionally does not, allowing soft deletes.

Positive balance means the partner owes the current user. For ordinary expenses,
add `partner_share` when the user paid and subtract it when the partner paid.
For settlements, add `total_amount` when the user paid and subtract when the
partner paid. See the [split service](../src/services/splitExpenses.js).

## Aggregation and mutation contracts

All aggregation and batched mutation functions below are SECURITY INVOKER,
retaining RLS. Call them through existing services/hooks rather than duplicating
queries in components. SQL return declarations and service joins define exact shapes.

| Function | Parameters | Result |
| --- | --- | --- |
| `get_transaction_years` | None | Integer array from earliest transaction year through current year + 1 |
| `get_account_balances` | `p_projected_to_date DATE DEFAULT NULL` | Account rows plus `transaction_net`, `balance`, `pending_net`, `projected_balance`, `is_asset` |
| `get_net_worth_history` | `p_projected_to_date DATE DEFAULT NULL` | JSONB history consumed by account services |
| `get_account_balance_history` | `p_account_ids UUID[]`, `p_start DATE`, `p_end DATE` | Rows `{date, balances JSONB, total BIGINT}` |
| `get_plan_vs_actual` | `p_month INTEGER`, `p_year INTEGER`, `p_as_of DATE DEFAULT NULL` | JSONB category plan/actual breakdown |
| `get_plan_vs_actual_ytd` | `p_year INTEGER`, `p_through_month INTEGER`, `p_as_of DATE DEFAULT NULL` | JSONB year-to-date breakdown |
| `get_monthly_spending_trend` | `p_months INTEGER`, `p_end_month INTEGER DEFAULT NULL`, `p_end_year INTEGER DEFAULT NULL`, `p_as_of DATE DEFAULT NULL` | Rows `{key, label, year, month, spent, income, tx_count}` |
| `get_yearly_spending_trend` | `p_years INTEGER`, `p_end_month INTEGER DEFAULT NULL`, `p_end_year INTEGER DEFAULT NULL`, `p_as_of DATE DEFAULT NULL` | Rows `{year, spent, income, tx_count}` |
| `bulk_update_transactions` | `p_updates JSONB` array | JSONB updated rows with category/account joins; absent keys unchanged, explicit null handled per field |
| `bulk_update_category_sort_order` | `p_items JSONB` array of ID/sort-order objects | Void |
| `upsert_recurring_group` | `p_parent_id UUID`, `p_parent JSONB`, `p_children JSONB` | Parent UUID; service refetches nested/joined templates |

For the four report RPCs, a non-null `p_as_of` (the client's local date)
limits actuals to `posted` rows dated on or before it, excluding projected,
pending, and future-dated rows; NULL counts every live row. The client
equivalent is `isSettledTransaction` in the [helpers](../src/utils/helpers.js).
Reports exclude these rows by default and offer an "Include upcoming" toggle.

The aggregation script also defines immutable `_is_asset_account(p_type TEXT)`.
The mutation script defines invoker `assert_account_open()` and its transaction
BEFORE INSERT trigger, rejecting inserts into closed accounts.
The sync migration defines `set_updated_at()` and category/budget-item/recurring
UPDATE triggers. Archive/partner/soft-delete functions are documented with their tables.

`is_income` alone cannot classify reports: genuine income requires an income
category, spending-category credits reduce spend, and income-category debits
reduce income. Transfers are excluded from budgeting totals. Reuse
[classification helpers](../src/utils/helpers.js) and
[aggregation SQL](../sql_scripts/supabase_phase3_aggregations.sql).
Services paginate backend reads rather than silently truncate at the default
1,000-row PostgREST limit.

## Offline cache & sync metadata

[`offlineDb.js`](../src/services/offlineDb.js) defines the `BudgetAppOffline`
Dexie database. It mirrors seven public tables: transactions, categories,
accounts, budget plans/items, preferences, and recurring templates.
Partnerships and split expenses are **not** Dexie-mirrored; their query hooks
use the shared services.

Dexie stores every row property; only declared indexes are queryable with
`.where()`. See the executable store declarations for exact indexed fields.
Compound indexes include `[user_id+month+year]`, `[budget_plan_id+category_id]`,
and `[user_id+preference_key]`.

| Local field/store | Contract |
| --- | --- |
| `_offline` | Numeric 1 when pending sync |
| `_action` | `create`, `update`, or `delete` |
| `_offlineAt` | ISO local mutation timestamp used in conflict resolution |
| `_archiveRestore` | Local category-restore marker; stripped before backend writes |
| `sync_meta` | Key `table_name`; `last_synced` ISO pull watermark |
| `rpc_cache` | Key `key`; cached `value` and `updated_at` for derived RPC results |

Sync strips local metadata and joined objects before backend writes, then clears
pending flags on success. Full pulls record a watermark; incremental pulls
use `.gt('updated_at', last_synced)` and advance to the newest returned timestamp.
Empty incremental pulls do not advance it. Conflicts use last-write-wins
(server `updated_at` versus local `_offlineAt`). Active/deleted flags allow
local removal reconciliation subject to backend row visibility.

The updated-at migration is required: base creation alone omits timestamps on
categories, budget items, and recurring templates. It adds those columns and
their update triggers; other write paths maintain timestamps in services/RPCs.

React Query is the in-memory layer above Dexie, with five-minute stale time and
30-minute garbage collection in [queryClient](../src/services/queryClient.js).
Read hooks use `[tableName, ...specifics]` keys. Offline mutations notify table
changes; [queryBridge](../src/services/queryBridge.js) invalidates the seven
mirrored namespaces plus explicitly configured derived dependencies.
Non-mirrored partnership/split queries retain their existing invalidation paths.
See [contributor instructions](../.github/AGENTS.md) for read/write rules.

## SQL migration scripts

Do not squash or delete incremental migrations because fresh installs contain
some of their effects. Existing databases still need the applicable upgrades.
The [setup guide](./SETUP_GUIDE.md#complete-a-fresh-supabase-installation) defines
the full Supabase fresh-install sequence, also listed in the
[SQL setup guide](../sql_scripts/README.md). Top-level SQL files participate in
current setup; [`migrations/`](../sql_scripts/migrations/README.md) retains
historical upgrades and repairs. Local fresh installs use
[`local/apply_order.txt`](../sql_scripts/local/apply_order.txt), with local-only
roles/auth first and grants last; historical repairs are excluded.

| Script | Role |
| --- | --- |
| [supabase_schema_create.sql](../sql_scripts/supabase_schema_create.sql) | Non-rerunnable base CREATEs for seven core tables and soft-delete RPC |
| [supabase_split_expenses.sql](../sql_scripts/supabase_split_expenses.sql) | Non-rerunnable partnership/split CREATEs and partner-email RPC; after core base |
| [supabase_add_updated_at.sql](../sql_scripts/supabase_add_updated_at.sql) | Sync columns/triggers; required on fresh installs and unapplied existing databases |
| [supabase_category_archiving.sql](../sql_scripts/supabase_category_archiving.sql) | Archive column/RPC/guards; after core base and updated-at migration |
| [supabase_phase3_aggregations.sql](../sql_scripts/supabase_phase3_aggregations.sql) | Aggregation RPCs/helper/indexes; after required columns exist |
| [supabase_phase4_mutations.sql](../sql_scripts/supabase_phase4_mutations.sql) | Batched writes and closed-account guard; follows aggregation installation |
| [supabase_rls_complete.sql](../sql_scripts/supabase_rls_complete.sql) | Drops/recreates complete policies; requires partnership/split tables too |
| [migrations/supabase_recurring_occurrence_date.sql](../sql_scripts/migrations/supabase_recurring_occurrence_date.sql) | Existing-row backfill and dedup-index replacement; column and both indexes now in core base |
| [migrations/supabase_transactions_soft_delete_rls.sql](../sql_scripts/migrations/supabase_transactions_soft_delete_rls.sql) | Repairs legacy transaction RLS and installs soft-delete RPC; effects in current core base |
| [migrations/supabase_recurring_projection_cleanup.sql](../sql_scripts/migrations/supabase_recurring_projection_cleanup.sql) | Installs owner-scoped recurring cleanup RPC; included in current phase-4 mutations |
| [migrations/supabase_report_as_of.sql](../sql_scripts/migrations/supabase_report_as_of.sql) | Replaces the four report RPCs with `p_as_of` versions; included in current phase-3 aggregations |
| [migrations/supabase_accounts_closed.sql](../sql_scripts/migrations/supabase_accounts_closed.sql) | Adds account `closed_at` and recurring `is_paused`; folded into core base |
| [migrations/supabase_asymmetric_transfer.sql](../sql_scripts/migrations/supabase_asymmetric_transfer.sql) | Adds recurring `to_amount`/constraint; folded into core base |
| [migrations/supabase_custom_interval.sql](../sql_scripts/migrations/supabase_custom_interval.sql) | Adds custom schedule columns/checks; folded into core base |
| [migrations/supabase_split_recurring.sql](../sql_scripts/migrations/supabase_split_recurring.sql) | Adds recurring split columns/checks; folded into core base |
| [migrations/supabase_partnership_seen.sql](../sql_scripts/migrations/supabase_partnership_seen.sql) | Adds partnership seen timestamps; folded into split base |
| [migrations/supabase_split_dedup.sql](../sql_scripts/migrations/supabase_split_dedup.sql) | Soft-deletes duplicates and adds live transaction uniqueness; index in split base |
| [migrations/supabase_split_fix_rls.sql](../sql_scripts/migrations/supabase_split_fix_rls.sql) | Repairs split soft-delete policies; folded into split base and complete RLS |
| [migrations/supabase_partnership_hardening_rls.sql](../sql_scripts/migrations/supabase_partnership_hardening_rls.sql) | Pending-only partnership inserts, `partnerships_guard` trigger, one-active-partnership indexes, split payer/transaction checks; folded into split base and complete RLS |

The [local SQL README](../sql_scripts/local/README.md) documents local roles,
auth helpers, default grants, initialization, and the legacy local-fix entrypoint
that delegates to the shared transaction repair. Initialization only runs on a
fresh volume. Existing self-hosted volumes require explicit release-specific
`psql` migrations; never apply the whole initializer to an existing database.

## Database change workflow

Update this reference, the applicable base/migration SQL, and affected services
together. Follow the [database checklist](../.github/AGENTS.md#database-change-workflow)
for local compatibility and RLS rules. The
[security guide](./SECURITY.md) explains invariants; the
[archive](./archive/README.md) contains historical plans, not current contracts.

**Document version**: 3.3

**Last updated**: 2026-11-11
