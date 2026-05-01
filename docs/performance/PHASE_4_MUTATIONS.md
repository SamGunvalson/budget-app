# Phase 4 — Mutation batching & write-path cleanup

**Status:** ✅ Shipped
**Builds on:** Phase 3 (server-side aggregations).
**Goal:** Replace every chatty multi-round-trip mutation path with a single
Postgres RPC (or trigger), so writes scale O(1) round-trips no matter how
many rows the user touched.

## Motivation

After Phase 3, the slow paths left in the app were the **write** paths:

- `bulkUpdateTransactions` issued N parallel `UPDATE` round-trips, one per
  edited row. The "save all inline edits" button's latency therefore scaled
  linearly with the number of edits.
- `bulkUpdateSortOrder` (categories drag-reorder) had the same shape:
  N parallel `UPDATE`s.
- `createRecurringGroup` / `updateRecurringGroup` ran the parent insert/update
  serially, then walked children one at a time. A 5-line group meant
  6 round-trips on create and up to 11 on update (1 parent UPDATE + 1 SELECT
  for existing IDs + N child UPDATE/INSERT + M soft-deletes).
- Every `createTransaction*` path made an extra `SELECT closed_at` against
  `accounts` just to enforce the closed-account guard before the actual
  INSERT.

All four are gone now.

## What shipped

### 1. SQL: bulk-mutation RPCs + trigger

Single migration script: [`sql_scripts/supabase_phase4_mutations.sql`](../../sql_scripts/supabase_phase4_mutations.sql)
(idempotent — safe to re-run).

| Object                                                           | Type     | Replaces (client-side)                                                                        |
| ---------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `bulk_update_transactions(p_updates jsonb)`                      | Function | `Promise.all(updates.map(updateTransaction))`                                                 |
| `bulk_update_category_sort_order(p_items jsonb)`                 | Function | `Promise.all(items.map(supabase.from('categories').update(...)))`                             |
| `upsert_recurring_group(p_parent_id, p_parent, p_children)`      | Function | `createRecurringTemplate` parent + N `createRecurringTemplate` children, or update equivalent |
| `assert_account_open()` + `trg_transactions_assert_account_open` | Trigger  | `assertAccountOpen()` SELECT before every transaction insert                                  |

All RPCs are `SECURITY INVOKER`, pin `SET search_path = public`, and filter
by `auth.uid()` so existing RLS policies remain authoritative — no policy
duplication in SQL.

### 2. JS: thin RPC wrappers replace fan-out

| Caller                                            | Before                                                            | After                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `services/transactions.js#bulkUpdateTransactions` | `Promise.all(updates.map(updateTransaction))`                     | one `supabase.rpc('bulk_update_transactions')` returning joined rows  |
| `services/categories.js#bulkUpdateSortOrder`      | parallel `update().eq('id', id)` per item                         | one `supabase.rpc('bulk_update_category_sort_order')`                 |
| `services/recurring.js#createRecurringGroup`      | `createRecurringTemplate` parent + per-child inserts              | one `supabase.rpc('upsert_recurring_group', { p_parent_id: null })`   |
| `services/recurring.js#updateRecurringGroup`      | parent UPDATE + child SELECT + N UPDATE/INSERT + soft-delete loop | one `supabase.rpc('upsert_recurring_group', { p_parent_id })`         |
| `services/transactions.js#assertAccountOpen`      | extra SELECT before every create\*                                | removed; trigger raises `check_violation` with the same friendly text |

The `bulkUpdateTransactions` RPC returns each updated row enriched with the
same `categories` and `accounts` joins the per-row path returned, so the
`useTransactionManager` reconciliation (`prev.map((t) => map.get(t.id) || t)`)
keeps working unchanged.

### 3. Field semantics preserved

The RPCs match the per-row updaters exactly so callers don't need to change:

- A field absent from the input object → column left alone (`updateTransaction`'s
  `if (updates.field !== undefined)` guard, ported into SQL via
  `CASE WHEN raw ? 'field' THEN ... ELSE col END`).
- An explicit `null` → column cleared, where the schema allows it.
- `description` is trimmed; empty `payee` becomes `NULL` — same normalization
  the JS path applied.

## Closed-account guard: client → trigger

Before:

```js
async function assertAccountOpen(accountId) {
  const { data } = await supabase
    .from("accounts").select("closed_at").eq("id", accountId).single();
  if (data?.closed_at) throw new Error("Cannot create transactions on a closed account.");
}

export async function createTransaction(...) {
  await assertAccountOpen(account_id);   // extra round-trip
  ...
}
```

After: the BEFORE INSERT trigger raises with the same message, so existing
`error.message` propagation in the modals just works. `createTransfer` /
`createLinkedTransfer` benefit twice because they were doing two of these
SELECTs before.

## What did NOT change

- **`useTransactionManager`** still updates local state imperatively after
  each mutation. Wiring it through `useMutation`'s `onMutate` for true
  optimistic UI was bullet 3 of the plan but is deferred — the existing
  imperative `setTransactions` flow + Phase 2's `notifyTable` invalidation
  already covers the UI staleness gap. Revisit if profiling shows
  perceptible flicker on bulk save.
- **Single-row mutations** (`updateTransaction`, `createCategory`, etc.)
  still go through their existing per-row paths. They were never the
  bottleneck — only the bulk fan-outs were.
- **Offline path** (`offlineAware.js`) is untouched. None of these bulk
  mutations had offline wrappers before; they still don't. They require
  online — same as before — and surface the network error if not.

## Migration steps

1. Run [`sql_scripts/supabase_phase4_mutations.sql`](../../sql_scripts/supabase_phase4_mutations.sql)
   against the project (idempotent). This installs the four RPCs and the
   trigger.
2. Deploy the JS changes. No client-side cache or schema bump needed —
   query keys, Dexie tables, and react-query bridge all unchanged.

## Risk & rollback

- The trigger silently changes the failure mode for inserts on closed
  accounts: same message text, but it now arrives as a Postgres
  `check_violation` instead of a client-thrown `Error`. UI surfaces both
  via `error.message`, so users see the same toast.
- To roll back the JS changes: revert the diffs in
  `services/transactions.js`, `services/categories.js`, and
  `services/recurring.js`. The SQL functions can stay in place — they're
  inert when no client calls them.
- To roll back the trigger only:
  ```sql
  DROP TRIGGER IF EXISTS trg_transactions_assert_account_open ON transactions;
  ```
  Then restore `assertAccountOpen()` and its call sites.
