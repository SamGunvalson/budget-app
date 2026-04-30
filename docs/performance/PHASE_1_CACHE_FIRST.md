# Phase 1 — Cache-first reads + incremental sync

**Status:** Shipped
**Touches:** `src/services/cache.js` (new), `src/services/offlineDb.js`,
`src/services/sync.js`, `src/services/offlineAware.js`,
`src/components/common/SyncStatus.jsx`, `src/hooks/useRevalidating.js` (new),
`docs/DATA_MODEL.md` (offline-cache section).

## Why

Before Phase 1, every read was **network-first**: `offlineAware.tryOnline()`
unconditionally awaited Supabase whenever `navigator.onLine` was true and only
fell back to Dexie when offline. That meant every page navigation paid the
full Supabase round-trip latency before rendering — even though we already
keep a faithful mirror of the user's data in IndexedDB.

`pullAll()` also wiped + re-bulkPut every table on every mount, on every
`online` event, **and** on a 5-minute interval, generating a non-trivial
Supabase + IndexedDB cost even when nothing had changed.

## What changed

### 1. `services/cache.js` (new) — SWR primitives

Three pieces:

- **`swrRead({ key, readCache, fetchFresh, writeCache, table, isEmpty? })`**
  — the stale-while-revalidate read helper. Returns the Dexie value
  immediately. If we're online _and_ the cache is non-empty, kicks a
  background `fetchFresh` whose result is written back via `writeCache` and
  announced via `notifyTable(table)`. If the cache is empty (cold) it awaits
  the network so the first paint has data.
- **`subscribeTable(table, fn)` / `notifyTable(table)`** — a tiny pub/sub so
  consumers (or React Query in Phase 2) can react when fresh data lands.
- **`subscribeRevalidating(fn)` / `getRevalidating()`** — a counter-backed
  "is anything refreshing right now?" boolean for the TopBar pill.

In-flight de-duplication on `key` ensures concurrent callers of the same
read share a single Supabase request.

### 2. `services/offlineDb.js` — incremental cache helpers

Added:

- **`cacheTableIncremental(name, rows, { removedIds, latestUpdatedAt })`** —
  bulk-puts rows _without clearing_ the table. Skips any row whose `id`
  already has `_offline === 1` set (so we never trample a pending offline
  mutation). Optionally hard-deletes ids the server reports as removed.
- **`getTableLastSynced(name)`** — reads the `sync_meta.last_synced`
  watermark for a table (returns `null` when the table has never been
  pulled).
- **`getTableRowCount(name)`** — used by sync to detect a cold cache.

### 3. `services/sync.js` — incremental `pullAll`

`pullAll({ full = false })` now:

1. For each of the seven synced tables, reads its watermark.
2. **Cold cache or `full: true`** → does the original full pull (filters out
   inactive / soft-deleted rows) via `cacheTable`.
3. **Warm cache** → fetches `.gt('updated_at', last_synced)` paginated,
   ordered by `updated_at` ascending. Splits the result into upserts vs
   removed (rows where `deleted_at IS NOT NULL` or `is_active = false`),
   calls `cacheTableIncremental`, and advances the watermark to the maximum
   `updated_at` returned by the server.
4. Calls `notifyTable(name)` after each table updates.

The **5-minute polling `setInterval` was removed**. Per-table revalidation
now happens cache-first on each read; full reconciliation happens on
`online` events and on explicit `requestSync()`.

### 4. `services/offlineAware.js` — priority reads converted

The following hot reads became cache-first SWR (signatures unchanged; same
return shape as before):

- `getTransactionsOffline(filters)`
- `getTransactionsYTDOffline({ year, throughMonth })`
- `getTransactionsForYearOffline({ year })`
- `getAccountsOffline()`
- `getAccountBalancesOffline({ projectedToDate })` — local compute is the
  reader, fresh fetch is the Supabase RPC; only the underlying account rows
  (computed fields stripped) are written back to Dexie.
- `getCategoriesOffline()`
- `getUserPreferenceOffline(key)` — uses a custom `isEmpty` so a cached
  `false` / `0` / `null` value isn't mistaken for a cache miss.
- `getBudgetPlanOffline(month, year)` — uses a custom `isEmpty` so an
  intentionally-missing plan (`null`) isn't mistaken for a cache miss.
- `getBudgetItemsOffline(budgetPlanId)` — re-attaches the cached category
  join on the cache read so the UI sees the same shape from both paths.

Mutation wrappers (`createTransactionOffline`, `updateAccountOffline`,
`setUserPreferenceOffline`, etc.) **kept** the existing `tryOnline`
network-first pattern. Cache-first only applies to reads.

Less-hit reads (`getNetWorthHistoryOffline`, `getMaxProjectedDateOffline`,
`getAccountBalanceHistoryOffline`, `getUpcomingTransactionsOffline`,
`getPendingReviewCountOffline`, `getTemplatesForAccountOffline`) were left
on the existing `tryOnline` pattern — they are either compute-heavy or
infrequent, and the overall page they live on already gets the SWR benefit
through the sibling reads.

### 5. `components/common/SyncStatus.jsx` + `hooks/useRevalidating.js`

Added a subtle slate "Refreshing…" pill that appears whenever any
`swrRead` is performing a background revalidation. It sits below
Offline / Syncing / Error / Pending in priority so it never replaces a
more-important indicator.

## Watermark protocol

```
Dexie sync_meta:  { table_name: PK, last_synced: ISO timestamp }
```

- A successful **full pull** writes `now()` as the watermark.
- A successful **incremental pull** writes `max(updated_at across rows)` as
  the watermark. When the incremental pull returns zero rows, the watermark
  is **not** advanced, so we don't risk skipping a row whose `updated_at`
  fell between our last-known watermark and "now-ish on the server".
- The watermark is per-table; tables advance independently.

## Consistency / risks

- **Brief stale UI.** Until a background revalidation completes, users see
  cached data that may be a few seconds older than the server. Mutations
  from the same tab still update the cache synchronously, so this only
  matters when another device wrote a row between this tab's last
  revalidation and now.
- **Cross-tab fanout** is not addressed in Phase 1. Two tabs in the same
  browser will each have their own SWR loop; mutations in tab A update
  tab A's Dexie, but tab B won't notice until its next read or its next
  `online` event. A `BroadcastChannel('sync')` ping is queued for Phase 2.
- **Background fetch errors are swallowed** in `swrRead` (logged at
  `console.debug` / `console.warn`). Rationale: the user is already
  looking at cached data; surfacing a transient network blip as a hard
  error is worse UX than continuing to show the cache. Mutations keep
  their existing error paths.
- **Watermark drift.** If the server clock and a row's `updated_at`
  trigger ever fall out of sync, the watermark could advance past a row
  that hasn't been written yet. All tables' triggers stamp `updated_at`
  on the same Postgres clock, so this is not a concern in practice.

## Verification

- `npm run lint` — clean.
- `npm run build` — builds without warnings; bundle size unchanged.
- Manual: open DevTools → Application → IndexedDB → BudgetAppOffline →
  `sync_meta` to inspect the per-table watermarks.

## What's next (Phase 2 preview)

- Wrap reads in `@tanstack/react-query` so background revalidation
  automatically re-renders consumers (today they need to remount or
  navigate away/back to see fresh data).
- Add a `BroadcastChannel('budget-sync')` so mutations in one tab
  invalidate the corresponding query keys in sibling tabs.
- Move the `SyncStatus` "Refreshing…" pill driver onto the React Query
  global `isFetching` count so it's strictly correct.
