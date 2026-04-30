/**
 * Bridge between the Phase 1 cache layer (`services/cache.js`) and the
 * Phase 2 react-query L1 cache.
 *
 * Whenever the cache layer announces that a Dexie table has changed
 * (background SWR revalidation completed, sync pulled new rows, or a
 * mutation wrapper updated a local table), we tell react-query to
 * invalidate every query keyed under that table name. The `useQuery`
 * subscribers will then re-run their `queryFn` — which goes back through
 * `services/offlineAware.js`, gets the fresh Dexie value immediately, and
 * re-renders with it. No imperative `setState` plumbing required.
 *
 * **Query-key convention**: every query key is `[tableName, ...specifics]`,
 * so `invalidateQueries({ queryKey: [tableName] })` matches anything
 * scoped to that table (filtered, paginated, joined, etc.). Hooks in
 * `src/hooks/queries.js` enforce this convention.
 */
import { subscribeTable } from "./cache";
import { queryClient } from "./queryClient";

// The seven mirrored Supabase tables. Anything not on this list won't get
// auto-invalidation; that's intentional (e.g. RPC-derived shapes like
// account_balances are derived from `accounts` + `transactions` and get
// invalidated when *those* tables fire).
const BRIDGED_TABLES = [
  "transactions",
  "categories",
  "accounts",
  "budget_plans",
  "budget_items",
  "user_preferences",
  "recurring_templates",
];

let _initialized = false;

/**
 * Wire the bridge. Call once at app boot (idempotent).
 *
 * Side effects: registers a listener per table on the cache pub/sub. The
 * listeners stay alive for the lifetime of the page — they're not torn
 * down because the QueryClient is a singleton.
 */
export function initQueryBridge() {
  if (_initialized) return;
  _initialized = true;

  for (const table of BRIDGED_TABLES) {
    subscribeTable(table, (changedTable) => {
      // Invalidate every query whose key starts with this table name.
      // `refetchType: 'active'` means only currently-mounted queries refetch
      // immediately; inactive queries are marked stale and refetch on next
      // mount. That's what we want — we shouldn't pay for off-screen data.
      queryClient.invalidateQueries({
        queryKey: [changedTable],
        refetchType: "active",
      });
    });
  }

  // Cross-table dependencies: account balances, net-worth history, and
  // upcoming-transactions queries are all derived from the `transactions`
  // table even though they live under the `accounts` query namespace.
  // When `transactions` changes, also invalidate the derived accounts shapes.
  subscribeTable("transactions", () => {
    queryClient.invalidateQueries({
      queryKey: ["accounts", "balances"],
      refetchType: "active",
    });
    queryClient.invalidateQueries({
      queryKey: ["accounts", "netWorthHistory"],
      refetchType: "active",
    });
    queryClient.invalidateQueries({
      queryKey: ["accounts", "balanceHistory"],
      refetchType: "active",
    });
    queryClient.invalidateQueries({
      queryKey: ["accounts", "maxProjectedDate"],
      refetchType: "active",
    });
  });
}

/**
 * Manually invalidate every query for a table. Use this from imperative
 * mutation paths that don't want to wait for a `notifyTable` round-trip,
 * e.g. inside an optimistic update or after a bulk operation.
 */
export function invalidateTable(tableName) {
  queryClient.invalidateQueries({
    queryKey: [tableName],
    refetchType: "active",
  });
}
