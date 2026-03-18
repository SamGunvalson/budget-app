/**
 * Sync engine — pushes offline-queued mutations to Supabase when online.
 *
 * Flow:
 * 1. Listen for `online` events.
 * 2. On coming online (or manual trigger), read all `_offline === 1` records
 *    from IndexedDB via the syncQueue.
 * 3. Replay each mutation to Supabase (create → insert, update → update,
 *    delete → soft-delete or deactivate).
 * 4. On success, clear the offline flags.
 * 5. After all mutations succeed, pull fresh data from Supabase → IndexedDB
 *    to pick up any server-side changes (e.g., auto-generated ids, triggers).
 *
 * Conflict strategy: last-write-wins (offline timestamp vs server updated_at).
 */
import { supabase, getCurrentUser } from "./supabase";
import { markSynced, cacheTable } from "./offlineDb";
import { drainAll } from "../utils/syncQueue";

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
 */
export function startSyncListener() {
  window.addEventListener("online", () => {
    console.log("[sync] Online — starting sync");
    requestSync();
  });

  // Also sync on a periodic interval if online (catch anything missed)
  setInterval(
    () => {
      if (navigator.onLine) requestSync();
    },
    5 * 60 * 1000,
  ); // every 5 minutes
}

/**
 * Pull a full snapshot of the user's data from Supabase into IndexedDB.
 * Called on login / app boot when online.
 */
export async function pullAll() {
  if (!navigator.onLine) return;

  try {
    const user = await getCurrentUser();
    if (!user) return;

    // Pull all tables in parallel
    const [
      transactions,
      categories,
      budgetPlans,
      budgetItems,
      accounts,
      userPrefs,
      recurringTemplates,
    ] = await Promise.all([
      fetchAll(
        "transactions",
        "*, categories(id, name, color, type), accounts(id, name, type)",
      ),
      fetchAll("categories"),
      fetchAll("budget_plans"),
      fetchAll("budget_items", "*, categories(id, name, color, type)"),
      fetchAll("accounts"),
      fetchAll("user_preferences"),
      fetchAll(
        "recurring_templates",
        "*, categories(id, name, color, type), accounts!recurring_templates_account_id_fkey(id, name, type)",
      ),
    ]);

    await Promise.all([
      cacheTable("transactions", transactions),
      cacheTable("categories", categories),
      cacheTable("budget_plans", budgetPlans),
      cacheTable("budget_items", budgetItems),
      cacheTable("accounts", accounts),
      cacheTable("user_preferences", userPrefs),
      cacheTable("recurring_templates", recurringTemplates),
    ]);

    console.log("[sync] Full pull complete");
  } catch (err) {
    console.error("[sync] Pull failed:", err);
  }
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
 * Paginated fetch of all rows from a Supabase table for the current user.
 */
async function fetchAll(tableName, select = "*") {
  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from(tableName)
      .select(select)
      .range(from, from + PAGE_SIZE - 1);

    // transactions use soft-delete
    if (tableName === "transactions") {
      query = query.is("deleted_at", null);
    }

    // categories and accounts use is_active
    if (tableName === "categories" || tableName === "accounts") {
      query = query.eq("is_active", true);
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
