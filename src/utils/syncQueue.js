/**
 * Sync queue — buffers offline mutations and replays them to Supabase
 * when the device comes back online.
 *
 * Rather than patching every service function, the queue stores lightweight
 * "operation" objects that record *what* changed while offline.  The sync
 * engine (sync.js) reads these operations in order and applies them.
 *
 * Operations are ordered by timestamp so that they replay in causal order
 * (e.g., an account must be created before a transaction referencing it).
 */
import db, {
  bumpPendingCount,
  getPendingSyncCount,
} from "../services/offlineDb";

// ── Event emitter for sync-status listeners ──
const listeners = new Set();

export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners() {
  // Fire asynchronously so callers aren't blocked
  queueMicrotask(() => listeners.forEach((fn) => fn()));
}

// ── Enqueue an offline mutation ──
/**
 * Record that a row was created/updated/deleted while offline.
 *
 * The record is already stored in IndexedDB by the calling service;
 * this function just ensures the `_offline`, `_action`, and `_offlineAt`
 * flags are set on that record so the sync engine can discover it.
 *
 * @param {'transactions'|'categories'|'budget_plans'|'budget_items'|'accounts'|'user_preferences'|'recurring_templates'} tableName
 * @param {string} recordId — the primary-key `id` of the record
 * @param {'create'|'update'|'delete'} action
 */
export async function enqueue(tableName, recordId, action) {
  // Inspect the row first so we only bump the pending counter when this
  // mutation transitions a row from "clean" -> "pending".  Updating an
  // already-pending row should not double-count it.
  const prior = await db.table(tableName).get(recordId);
  const wasPending = prior?._offline === 1;
  await db.table(tableName).update(recordId, {
    _offline: 1,
    _action: action,
    _offlineAt: new Date().toISOString(),
  });
  if (!wasPending) bumpPendingCount(1);
  notifyListeners();
}

// ── Read all pending operations (used by sync engine) ──
/**
 * Returns every record across all synced tables that has `_offline === 1`,
 * grouped by table and sorted oldest-first within each table.
 *
 * @returns {Promise<Record<string, Array>>}
 */
export async function drainAll() {
  const TABLES = [
    // Order matters: accounts & categories before transactions
    "accounts",
    "categories",
    "budget_plans",
    "budget_items",
    "user_preferences",
    "recurring_templates",
    "transactions",
  ];

  const result = {};
  for (const t of TABLES) {
    const rows = await db.table(t).where("_offline").equals(1).toArray();
    if (rows.length) {
      // Sort by _offlineAt ascending (oldest first)
      rows.sort((a, b) =>
        (a._offlineAt || "").localeCompare(b._offlineAt || ""),
      );
      result[t] = rows;
    }
  }
  return result;
}

// ── Get total pending count (for badge) ──
//
// Phase 5: backed by a cached counter in `offlineDb` so this is O(1) after
// the initial scan.  Previously this re-scanned all 7 synced tables on every
// call and `useSyncStatus` invoked it on every keystroke that produced an
// offline mutation.
export async function pendingCount() {
  return getPendingSyncCount();
}
