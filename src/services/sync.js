/**
 * Sync engine — pushes offline-queued mutations to Supabase when online,
 * then pulls fresh data via an *incremental* watermark per table.
 *
 * Flow:
 * 1. Listen for `online` events.
 * 2. On coming online (or manual trigger), read all `_offline === 1` records
 *    from IndexedDB via the syncQueue.
 * 3. Replay each mutation to Supabase (create → insert, update → update,
 *    delete → soft-delete or deactivate).
 * 4. On success, clear the offline flags.
 * 5. After all mutations succeed, pull fresh data from Supabase → IndexedDB
 *    using each table's `sync_meta.last_synced` watermark so we only fetch
 *    rows whose `updated_at` is newer.
 *
 * Conflict strategy: last-write-wins (offline timestamp vs server updated_at).
 *
 * Phase 1 changes:
 *  - `pullAll` is now incremental by default. Cold caches still do a full
 *    pull (no watermark recorded yet → fetches everything since 1970).
 *  - The 5-minute polling interval was removed; revalidation now happens
 *    cache-first per read (see `services/cache.js`) and on `online` events.
 *  - Each successful per-table pull notifies subscribers via
 *    `notifyTable(tableName)` so consumers can react when fresh data lands.
 */
import { supabase, getCurrentUser } from "./supabase";
import {
  markSynced,
  cacheTable,
  cacheTableIncremental,
  getTableLastSynced,
  getTableRowCount,
} from "./offlineDb";
import { drainAll } from "../utils/syncQueue";
import { notifyTable } from "./cache";

// ── Sync state (observable) ──
let _syncing = false;
let _lastError = null;
let _syncProgress = { done: 0, total: 0 };
const _listeners = new Set();

export function onSyncChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notify() {
  queueMicrotask(() =>
    _listeners.forEach((fn) =>
      fn({
        syncing: _syncing,
        error: _lastError,
        progress: { ..._syncProgress },
      }),
    ),
  );
}

export function getSyncState() {
  return {
    syncing: _syncing,
    error: _lastError,
    progress: { ..._syncProgress },
  };
}

// ── Public API ──

/**
 * Run a full sync cycle: push pending offline changes, then pull fresh data.
 * Safe to call repeatedly — concurrent calls are coalesced.
 */
let _syncPromise = null;

export function requestSync() {
  if (_syncPromise) return _syncPromise;
  _syncPromise = _doSync().finally(() => {
    _syncPromise = null;
  });
  return _syncPromise;
}

/**
 * Start listening for online events. Call once at app boot.
 *
 * Phase 1 note: the 5-minute polling interval was intentionally removed.
 * Per-read SWR (services/cache.js) now keeps individual tables warm; full
 * re-pulls happen only on the `online` event or via explicit `requestSync()`.
 */
export function startSyncListener() {
  window.addEventListener("online", () => {
    console.log("[sync] Online — starting sync");
    requestSync();
  });
}

// ── Tables we sync, with their soft-delete / activation flag conventions ──
//
// Each table has `updated_at`; we use it as the incremental watermark.
// `softDeleteField` lets us pull "removed" rows so we can hard-delete them
// from Dexie locally (since the local cache is the source of UI truth and
// must not show server-deleted rows).
const SYNC_TABLES = [
  {
    name: "transactions",
    select: "*, categories(id, name, color, type), accounts(id, name, type)",
    softDeleteField: "deleted_at", // not-null = removed
    activeFilter: null,
  },
  {
    name: "categories",
    select: "*",
    softDeleteField: null,
    activeFilter: "is_active",
  },
  {
    name: "accounts",
    select: "*",
    softDeleteField: null,
    activeFilter: "is_active",
  },
  {
    name: "budget_plans",
    select: "*",
    softDeleteField: null,
    activeFilter: null,
  },
  {
    name: "budget_items",
    select: "*, categories(id, name, color, type)",
    softDeleteField: null,
    activeFilter: null,
  },
  {
    name: "user_preferences",
    select: "*",
    softDeleteField: null,
    activeFilter: null,
  },
  {
    name: "recurring_templates",
    select:
      "*, categories(id, name, color, type), accounts!recurring_templates_account_id_fkey(id, name, type)",
    softDeleteField: null,
    activeFilter: "is_active",
  },
];

/**
 * Pull fresh data from Supabase into IndexedDB.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.full=false] — when true, ignore the watermark and
 *   re-pull everything (used after sign-in, after a reset, or by a "Force
 *   refresh" affordance).
 * @returns {Promise<void>}
 */
export async function pullAll({ full = false } = {}) {
  if (!navigator.onLine) return;

  try {
    const user = await getCurrentUser();
    if (!user) return;

    await Promise.all(
      SYNC_TABLES.map((t) => pullTableIncremental(t, { full })),
    );

    console.log("[sync] Pull complete");
  } catch (err) {
    console.error("[sync] Pull failed:", err);
  }
}

/**
 * Pull a single table incrementally. Falls back to a full pull when the
 * local cache is empty (cold) or `full` is set.
 */
async function pullTableIncremental(tableConfig, { full = false } = {}) {
  const { name, select, softDeleteField, activeFilter } = tableConfig;
  const lastSynced = full ? null : await getTableLastSynced(name);
  const localCount = await getTableRowCount(name);
  const isCold = localCount === 0;

  // Cold cache or explicit full → do a clearing pull and write watermark.
  if (full || isCold || !lastSynced) {
    const rows = await fetchAll(name, select, {
      activeFilter,
      includeDeleted: false,
    });
    await cacheTable(name, rows);
    notifyTable(name);
    return;
  }

  // Incremental: fetch rows changed since lastSynced.
  // We fetch BOTH active and inactive/deleted so we can prune locally.
  const changed = await fetchAll(name, select, {
    activeFilter: null,
    includeDeleted: true,
    updatedSince: lastSynced,
  });

  if (!changed.length) {
    // Nothing changed — no watermark bump needed (it stays at the previous
    // server timestamp; no risk of missing an update).
    return;
  }

  // Split into upserts vs deletes.
  const removedIds = [];
  const upserts = [];
  for (const row of changed) {
    const isRemoved =
      (softDeleteField && row[softDeleteField] != null) ||
      (activeFilter && row[activeFilter] === false);
    if (isRemoved) removedIds.push(row.id);
    else upserts.push(row);
  }

  // Find the newest updated_at across the changed rows so we can advance
  // the watermark precisely. Falls back to ISO-now when somehow no row has
  // an updated_at (shouldn't happen — every table has the column).
  let latest = null;
  for (const r of changed) {
    if (r.updated_at && (!latest || r.updated_at > latest)) {
      latest = r.updated_at;
    }
  }

  await cacheTableIncremental(name, upserts, {
    removedIds,
    latestUpdatedAt: latest,
  });
  notifyTable(name);
}

// ── Internals ──

async function _doSync() {
  if (_syncing) return;
  if (!navigator.onLine) return;

  _syncing = true;
  _lastError = null;
  _syncProgress = { done: 0, total: 0 };
  notify();

  try {
    const pending = await drainAll();
    const allOps = Object.entries(pending);

    // Count total ops
    let total = 0;
    for (const [, rows] of allOps) total += rows.length;
    _syncProgress.total = total;
    notify();

    if (total === 0) {
      // Even with no pushes, run an incremental pull so this tab catches
      // up on remote changes (e.g., another device).
      await pullAll();
      _syncing = false;
      notify();
      return;
    }

    console.log(`[sync] Pushing ${total} offline changes…`);

    for (const [tableName, rows] of allOps) {
      for (const row of rows) {
        try {
          await pushRow(tableName, row);
          await markSynced(tableName, row.id);
        } catch (err) {
          console.error(`[sync] Failed to sync ${tableName}/${row.id}:`, err);
          _lastError = err.message || String(err);
          // Continue with other rows — don't let one failure block everything
        }
        _syncProgress.done++;
        notify();
      }
    }

    // After pushing, pull fresh data to reconcile server-side changes
    await pullAll();

    console.log("[sync] Push complete");
  } catch (err) {
    console.error("[sync] Sync failed:", err);
    _lastError = err.message || String(err);
  } finally {
    _syncing = false;
    notify();
  }
}

/**
 * Push a single offline record to Supabase.
 */
async function pushRow(tableName, row) {
  // Strip offline metadata before sending to Supabase
  const clean = { ...row };
  delete clean._offline;
  delete clean._action;
  delete clean._offlineAt;
  // Strip any joined objects that came from caching
  delete clean.categories;
  delete clean.accounts;
  delete clean.to_accounts;

  const action = row._action;

  if (action === "create") {
    const { error } = await supabase
      .from(tableName)
      .upsert(clean, { onConflict: "id" });
    if (error) throw error;
  } else if (action === "update") {
    const { id, ...updates } = clean;
    const { error } = await supabase
      .from(tableName)
      .update(updates)
      .eq("id", id);
    if (error) throw error;
  } else if (action === "delete") {
    if (tableName === "transactions") {
      // Soft-delete via RPC (mirrors service behavior)
      const { error } = await supabase.rpc("soft_delete_transaction", {
        txn_id: clean.id,
      });
      if (error) throw error;
    } else if (tableName === "categories" || tableName === "accounts") {
      // Soft-deactivate
      const { error } = await supabase
        .from(tableName)
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", clean.id);
      if (error) throw error;
    } else {
      // Hard delete for other tables
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq("id", clean.id);
      if (error) throw error;
    }
  }
}

/**
 * Paginated fetch of rows from a Supabase table for the current user.
 *
 * @param {string} tableName
 * @param {string} select
 * @param {Object} [opts]
 * @param {string|null} [opts.activeFilter] — column name to require `=true`
 *   (used for `categories`/`accounts`/`recurring_templates` on full pulls).
 * @param {boolean} [opts.includeDeleted=false] — when false, filters
 *   `deleted_at IS NULL` for tables that have it.
 * @param {string|null} [opts.updatedSince] — when set, filters
 *   `updated_at > opts.updatedSince` for incremental pulls.
 */
async function fetchAll(
  tableName,
  select = "*",
  { activeFilter = null, includeDeleted = false, updatedSince = null } = {},
) {
  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from(tableName)
      .select(select)
      .order("updated_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (!includeDeleted && tableName === "transactions") {
      query = query.is("deleted_at", null);
    }
    if (activeFilter) {
      query = query.eq(activeFilter, true);
    }
    if (updatedSince) {
      query = query.gt("updated_at", updatedSince);
    }

    const { data, error } = await query;
    if (error) throw error;
    allData = allData.concat(data);
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allData;
}
