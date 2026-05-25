# Copilot Instructions — Budget App

A personal budget tracking PWA built with React 19 + Vite, backed by Supabase (PostgreSQL + RLS), with full offline support via Dexie.js (IndexedDB).

## Commands

```bash
npm run dev       # Start dev server at http://localhost:5173
npm run build     # Production build
npm run lint      # ESLint (no tests exist)
```

## Architecture

### Data flow (reads)

All reads go through React Query hooks in `src/hooks/queries.js`. Each hook wraps a corresponding `*Offline` function from `src/services/offlineAware.js`, which serves Dexie (IndexedDB) immediately and revalidates from Supabase in the background (SWR pattern). **Do not call Supabase service functions directly from components** — go through the hooks.

### Data flow (writes)

Mutations are imperative calls to the `*Offline` wrappers in `src/services/offlineAware.js`. Each wrapper:

1. Online: calls the underlying Supabase service, then updates Dexie.
2. Offline: writes to Dexie with `_offline` flags and enqueues the mutation for sync.

After any mutation, `notifyTable(tableName)` is called internally, which triggers React Query to invalidate matching queries via `src/services/queryBridge.js`.

### Offline sync

`src/services/sync.js` pushes queued mutations to Supabase on reconnect using a last-write-wins strategy. The sync queue lives in `src/utils/syncQueue.js`.

### Cache invalidation

Query keys follow `[tableName, ...specifics]`. The bridge in `src/services/queryBridge.js` broad-invalidates all queries for a table when `notifyTable(tableName)` fires — so new mutations don't require manually specifying invalidation keys.

### Auth & RLS

Auth state is managed by `src/contexts/AuthContext.jsx`. Supabase Row-Level Security scopes all DB queries to the authenticated user — no need to manually filter by `user_id` in reads (but `user_id` must be set on inserts). The auth client is initialized in `src/services/supabase.js`.

### Routing

All pages are lazy-loaded. Each protected route is wrapped in `<ProtectedPage>` with a per-page skeleton fallback. Routes are defined in `src/App.jsx`.

## Key Conventions

### Money is always cents

All monetary values are stored and passed around as **integer cents**. Use the helpers from `src/utils/helpers.js`:

- `toCents(dollars)` — convert user input to cents before saving
- `toDollars(cents)` — convert for math (pass `{ raw: true }` to bypass safe-mode masking)
- `formatCurrency(cents)` — format for display (applies safe-mode masking)

Never store or compute with floats. Never pass dollar amounts to Supabase.

### Transaction classification

`is_income` alone does not determine whether something is income or a spending credit. Use the helpers:

- `isTrueIncome(tx)` — `is_income=true` AND category type is `'income'`
- `isSpendingCredit(tx)` — `is_income=true` in a spending category (reduces spend, not income)
- `isIncomeDebit(tx)` — `is_income=false` in an income category (reduces income total)

### Category types

Always one of: `'income'` | `'needs'` | `'wants'` | `'savings'` | `'transfer'`

### Dates

YYYY-MM-DD strings from the DB must be parsed as **local** dates, not UTC, to avoid off-by-one issues:

```js
new Date(dateStr + "T00:00:00"); // correct
new Date(dateStr); // wrong — parses as UTC midnight
```

### Soft deletes

The `transactions` and `split_expenses` tables use `deleted_at` (nullable timestamp) rather than hard deletes. Always filter `deleted_at IS NULL` in queries.

### Contexts

Each context is split into two files:

- `src/contexts/FooContext.jsx` — the provider component
- `src/contexts/fooContextValue.js` — the memoized value logic

Contexts: `AuthContext`, `MonthYearContext`, `SafeModeContext`, `ThemeContext`.

### Safe mode

Safe mode masks financial values for screenshots/screensharing. It hooks into `formatCurrency`, `toDollars`, `formatAxisDollar`, and `maskAccountName` — all in `src/utils/helpers.js`. Any new display of amounts or account names **must** go through these helpers rather than formatting inline.

### Styling

- Dark mode is default. All components must support both light and dark variants.
- Color palette: **stone** neutrals, **amber** primary/CTA, **teal/emerald** income/success, **violet** analytics, **red** errors/expenses.
- Background: `bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100` (light) / `dark:from-stone-950 dark:via-stone-900 dark:to-stone-950`
- Use `border-stone-200/60` (translucent) for borders — not solid grays.

### File naming

- Components: `PascalCase.jsx`
- Services, utils, hooks: `camelCase.js` / `camelCase.jsx`

## Key Reference Files

- **`docs/DATA_MODEL.md`** — authoritative DB schema with all table/column names and types. Always check this before writing queries or defining data shapes.
- **`docs/STYLE_GUIDE.md`** — full design system including color tokens, typography scale, and component patterns.
- **`docs/SECURITY.md`** — security invariants (RLS, input validation, etc.).
- **`sql_scripts/supabase_schema_create.sql`** — base schema; other files in `sql_scripts/` are incremental migrations.

## Database Change Workflow

Whenever you add, rename, or remove a column, table, function, or RLS policy, you **must** update these three things together:

1. **`docs/DATA_MODEL.md`** — update the affected table definition, constraints, RLS note, and the version/date at the bottom of the file.

2. **The relevant SQL script** — choose the right file:
   - New table → `sql_scripts/supabase_schema_create.sql` (creation) + a new `sql_scripts/supabase_<feature>.sql` migration for existing databases
   - New column on an existing table → add the column to `sql_scripts/supabase_schema_create.sql` so fresh installs include it, AND create a separate `ALTER TABLE` migration in `sql_scripts/supabase_<feature>.sql` for existing databases
   - RLS policy fix → create a new `sql_scripts/supabase_<description>_rls.sql` using `DROP POLICY IF EXISTS` + `CREATE POLICY` (not `IF NOT EXISTS`) so it corrects policies already on the DB, AND update `sql_scripts/supabase_rls_complete.sql` to match
   - New RPC function → add to the appropriate feature script and document in `DATA_MODEL.md`

3. **The service layer** — if a column or table name changed, update the corresponding file in `src/services/`.

### RLS authoring rules

- For tables with soft deletes (`deleted_at`), always split `USING` and `WITH CHECK` on UPDATE policies:
  - `USING`: include `deleted_at IS NULL` (can only update live rows)
  - `WITH CHECK`: do **not** include `deleted_at IS NULL` (must allow soft-delete writes that set the column)
- Never use `IF NOT EXISTS` for policies in `supabase_rls_complete.sql` — use `DROP POLICY IF EXISTS` + `CREATE POLICY` so re-running the script fixes existing incorrect policies.

## DB Change Checklist

When adding, renaming, or removing any column, table, function, or RLS policy:

1. ☐ `docs/DATA_MODEL.md` updated (table definition, constraints, RLS note, version/date)
2. ☐ SQL script created/updated (`supabase_schema_create.sql` + migration file)
3. ☐ Service layer updated (`src/services/` file for the affected table)
4. ☐ RLS policies use `DROP POLICY IF EXISTS` + `CREATE POLICY` (no `IF NOT EXISTS`)
5. ☐ Soft-delete tables (`transactions`, `split_expenses`): UPDATE policy `USING` includes `deleted_at IS NULL`; `WITH CHECK` does **not**
