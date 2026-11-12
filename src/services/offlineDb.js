import Dexie from "dexie";
import { notifyTable } from "./cache";

/**
 * Dexie (IndexedDB) database mirroring Supabase schema.
 *
 * Each table uses the same column names as Supabase.
 * Only indexed/queryable fields are declared — Dexie stores all properties
 * regardless, but only declared fields can be used in .where() clauses.
 *
 * Key design decisions:
 * - `id` is the primary key for every table (matches Supabase UUIDs).
 * - `_offline` flag marks records created/updated while offline (pending sync).
 * - `_action` tracks the operation type: 'create' | 'update' | 'delete'.
 * - Soft-delete pattern: transactions set `deleted_at` instead of removing rows.
 */

export const db = new Dexie("BudgetAppOffline");

db.version(2).stores({
  // ── Core tables (mirror Supabase) ──
  transactions: [
    "id",
    "user_id",
    "account_id",
    "category_id",
    "transaction_date",
    "is_income",
    "status",
    "transfer_group_id",
    "recurring_template_id",
    "deleted_at",
    "_offline", // boolean — true when pending sync
    "_action", // 'create' | 'update' | 'delete'
    "_offlineAt", // ISO timestamp of offline mutation
  ].join(", "),

  categories: [
    "id",
    "user_id",
    "type",
    "is_active",
    "sort_order",
    "_offline",
    "_action",
    "_offlineAt",
  ].join(", "),

  budget_plans: [
    "id",
    "user_id",
    "month",
    "year",
    "[user_id+month+year]", // compound index for quick lookups
    "_offline",
    "_action",
    "_offlineAt",
  ].join(", "),

  budget_items: [
    "id",
    "budget_plan_id",
    "category_id",
    "[budget_plan_id+category_id]", // compound uniqueness mirror
    "_offline",
    "_action",
    "_offlineAt",
  ].join(", "),

  accounts: [
    "id",
    "user_id",
    "type",
    "is_active",
    "closed_at",
    "_offline",
    "_action",
    "_offlineAt",
  ].join(", "),

  user_preferences: [
    "id",
    "user_id",
    "preference_key",
    "[user_id+preference_key]",
    "_offline",
    "_action",
    "_offlineAt",
  ].join(", "),

  recurring_templates: [
    "id",
    "user_id",
    "account_id",
    "category_id",
    "frequency",
    "is_active",
    "is_paused",
    "group_id",
    "is_group_parent",
    "_offline",
    "_action",
    "_offlineAt",
  ].join(", "),

  // ── Sync metadata ──
  // Tracks the last successful full-sync timestamp per table.
  sync_meta: "table_name",
});

// Phase 3: persistent SWR cache for server-side aggregation RPCs.  Each row
// is { key, value, updated_at }.  Adding a new store requires a Dexie
// version bump; v3 leaves all existing stores untouched.
db.version(3).stores({
  rpc_cache: "key",
});

// ── Phase 3 RPC cache helpers ──
//
// Read: returns the cached `value` for `key` or `null` when missing.  Errors
// are swallowed (cache miss is non-fatal — the SWR layer will fall through to
// the network).
export async function readRpcCache(key) {
  try {
    const row = await db.rpc_cache.get(key);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

// Write: best-effort upsert.  Quota / serialization errors are logged and
// swallowed so a flaky write never breaks rendering.
export async function writeRpcCache(key, value) {
  try {
    await db.rpc_cache.put({
      key,
      value,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(`[offlineDb] writeRpcCache(${key}) failed:`, err);
  }
}

// `newId` lives in utils/ids.js; re-exported here for existing importers.
export { newId } from "../utils/ids";

// Pending-sync counter state; see the Phase 5 notes further down.
let _pendingCountCache = null; // null = not initialised yet
let _pendingCountInit = null; // in-flight initial scan
// Bumped whenever the pending set changes underneath an in-flight scan (a
// mutation before the counter is initialised, or a full wipe). A scan only
// publishes its total if the generation is unchanged since it started.
let _pendingCountGeneration = 0;

// Drop every cached RPC result. Called when a local write is queued: the
// stored server-computed values no longer reflect the local data.
export async function clearRpcCache() {
  try {
    await db.rpc_cache.clear();
  } catch (err) {
    console.warn("[offlineDb] clearRpcCache failed:", err);
  }
}

// ── Helper: wipe all offline data (e.g. on sign-out) ──
export async function clearAllOfflineData() {
  await Promise.all([
    db.transactions.clear(),
    db.categories.clear(),
    db.budget_plans.clear(),
    db.budget_items.clear(),
    db.accounts.clear(),
    db.user_preferences.clear(),
    db.recurring_templates.clear(),
    db.sync_meta.clear(),
    db.rpc_cache.clear(),
  ]);
  // Every pending row is gone, so the cached counter is stale. Reset it so
  // the next user does not inherit the previous user's count. Zero (rather
  // than "uninitialised") is exact for empty tables and avoids a rescan.
  _pendingCountGeneration++; // discard any scan that started before the wipe
  _pendingCountCache = 0;
  _pendingCountInit = null;
}

// ── Local write log ──
//
// When each row was last written to the mirror by this tab, on the local
// clock. A background revalidation that started before a row was written
// cannot know about it, so it must neither delete nor overwrite that row
// (see `writtenSince`). Kept in memory only: an in-flight fetch does not
// survive a reload either. Row contents are not touched, so nothing extra
// is compared by the SWR change detection or sent to the server.
const WRITE_LOG_TTL_MS = 10 * 60 * 1000;
const WRITE_LOG_PRUNE_AT = 5000;
const _writeLog = new Map(); // table → { all: number, ids: Map<id, number> }

function writeLogFor(tableName) {
  let entry = _writeLog.get(tableName);
  if (!entry) {
    entry = { all: 0, ids: new Map() };
    _writeLog.set(tableName, entry);
  }
  return entry;
}

/**
 * Record that rows were just written locally. `ids === null` means the
 * whole table was rewritten (a full pull).
 */
export function noteLocalWrite(tableName, ids) {
  const entry = writeLogFor(tableName);
  const now = Date.now();
  if (ids === null) {
    entry.all = now;
    entry.ids.clear();
    return;
  }
  for (const id of ids) entry.ids.set(id, now);
  if (entry.ids.size > WRITE_LOG_PRUNE_AT) {
    for (const [id, at] of entry.ids) {
      if (now - at > WRITE_LOG_TTL_MS) entry.ids.delete(id);
    }
  }
}

/** Was this row written locally at or after `since` (a `Date.now()` value)? */
export function writtenSince(tableName, id, since) {
  const entry = _writeLog.get(tableName);
  if (!entry) return false;
  return entry.all >= since || (entry.ids.get(id) ?? 0) >= since;
}

// ── Natural keys ──
//
// These tables are unique on the server by something other than `id`
// (`UNIQUE (user_id, preference_key)`, `UNIQUE (user_id, month, year)`,
// `UNIQUE (budget_plan_id, category_id)`). A row created locally can
// therefore stand for the same record as a server row with a different id.
// The local mirror holds one user's data, so `user_id` is left out here.
export const NATURAL_KEYS = {
  user_preferences: ["preference_key"],
  budget_plans: ["month", "year"],
  budget_items: ["budget_plan_id", "category_id"],
};

function naturalKeyOf(tableName, row) {
  const fields = NATURAL_KEYS[tableName];
  return fields ? JSON.stringify(fields.map((f) => row[f] ?? null)) : null;
}

// Decide which server rows may be written over the local rows in `local`
// (the current table contents) and which local rows they replace.
//
//  * A pending local row wins over the server copy with the same id.
//  * For natural-key tables a pending local row also wins over a server row
//    with the same natural key but a different id; and a server row replaces
//    any non-pending local row with the same natural key but a different id
//    (e.g. a placeholder cached before the server row was known).
function planServerWrite(tableName, rows, local) {
  const pendingIds = new Set();
  const byKey = new Map();
  for (const row of local) {
    if (row._offline === 1) pendingIds.add(row.id);
    const key = naturalKeyOf(tableName, row);
    if (key === null) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }

  const toPut = [];
  const toDelete = [];
  for (const row of rows) {
    if (pendingIds.has(row.id)) continue;
    const twins = (byKey.get(naturalKeyOf(tableName, row)) || []).filter(
      (l) => l.id !== row.id,
    );
    if (twins.some((l) => l._offline === 1)) continue;
    toDelete.push(...twins.map((l) => l.id));
    toPut.push(row);
  }
  return { toPut, toDelete };
}

// ── Helper: mirror rows that came from the server into a local table ──
//
// The one way server rows are written over existing local rows outside a
// full pull; see `planServerWrite` for what is kept.
export async function cacheServerRows(tableName, rows) {
  const written = rows.filter(Boolean);
  if (!written.length) return;
  const table = db.table(tableName);
  await db.transaction("rw", table, async () => {
    const local = NATURAL_KEYS[tableName]
      ? await table.toArray()
      : (await table.bulkGet(written.map((r) => r.id))).filter(Boolean);
    const { toPut, toDelete } = planServerWrite(tableName, written, local);
    if (toDelete.length) await table.bulkDelete(toDelete);
    if (toPut.length) await table.bulkPut(toPut);
    noteLocalWrite(tableName, toPut.map((r) => r.id));
  });
}

// ── Helper: cache a full Supabase result set into a local table ──
//
// Replaces the table contents with `rows`, except that rows still waiting to
// sync (`_offline === 1`) are kept as they are: a pending local row wins over
// the server copy with the same id (or the same natural key), and a pending
// row the server does not know about yet is not dropped. Runs in one
// transaction so readers never observe the table half-replaced.
//
// `lastSynced` is the watermark to record; the sync engine derives it from
// before the fetch (see sync.js). It defaults to the current time.
export async function cacheTable(tableName, rows, { lastSynced } = {}) {
  const table = db.table(tableName);
  await db.transaction("rw", table, db.sync_meta, async () => {
    const pending = await table.where("_offline").equals(1).toArray();
    const { toPut } = planServerWrite(tableName, rows, pending);
    const next = toPut.concat(pending);
    await table.clear();
    if (next.length) {
      await table.bulkPut(next);
    }
    await db.sync_meta.put({
      table_name: tableName,
      last_synced: lastSynced || new Date().toISOString(),
    });
  });
  noteLocalWrite(tableName, null);
}

// ── Helper: incremental cache update (Phase 1 — incremental sync) ──
//
// Used by sync.js when pulling only rows changed since the last successful
// sync. Unlike `cacheTable`, this does NOT clear the table — it only upserts
// the rows it was given and (optionally) hard-deletes ids the caller marks
// as removed. Pending offline mutations are preserved.
//
// `lastSynced` is the watermark to record; the sync engine derives it from
// before the fetch and the rows it returned (see sync.js).
export async function cacheTableIncremental(
  tableName,
  rows,
  { removedIds = [], lastSynced = null } = {},
) {
  const table = db.table(tableName);

  // Don't trample local pending mutations — see `cacheServerRows`.
  await cacheServerRows(tableName, rows);

  if (removedIds.length) {
    // Only delete rows that aren't in the offline-pending set.
    const pendingIds = await table.where("_offline").equals(1).primaryKeys();
    const pendingSet = new Set(pendingIds);
    const toDelete = removedIds.filter((id) => !pendingSet.has(id));
    if (toDelete.length) await table.bulkDelete(toDelete);
  }

  await db.sync_meta.put({
    table_name: tableName,
    last_synced: lastSynced || new Date().toISOString(),
  });
}

// ── Helper: drop pulled rows the mirror already holds ──
//
// An incremental pull overlaps the previous one by a margin, so it re-reads
// rows that are already mirrored. A row is unchanged when the local copy has
// the same `updated_at`; a removal is unchanged when the row is already gone.
export async function dropUnchangedRows(tableName, rows, removedIds = []) {
  const table = db.table(tableName);
  const local = await table.bulkGet(rows.map((r) => r.id));
  const present = await table.bulkGet(removedIds);
  return {
    rows: rows.filter(
      (row, i) => !local[i] || local[i].updated_at !== row.updated_at,
    ),
    removedIds: removedIds.filter((_, i) => present[i]),
  };
}

// ── Helper: read the last-synced timestamp for a table ──
export async function getTableLastSynced(tableName) {
  const row = await db.sync_meta.get(tableName);
  return row?.last_synced ?? null;
}

// ── Helper: count rows in a table (used to detect a cold cache) ──
export async function getTableRowCount(tableName) {
  return db.table(tableName).count();
}

// ── Helper: get all pending-sync records from a table ──
export async function getPendingRecords(tableName) {
  return db.table(tableName).where("_offline").equals(1).toArray();
}

// ── Phase 5: O(1) pending-sync counter ─────────────────────────────────────
//
// `getPendingSyncCount` previously counted across every synced table on each
// call (a 7-table COUNT scan).  `useSyncStatus` re-runs that on every offline
// mutation and on every sync-engine state change, so for a busy session it
// fired dozens of times in quick succession.
//
// We now keep the running total in a module-level cache that is:
//   * lazily initialised by a single full scan on first read,
//   * incremented inside `putOffline` (when the row was not already pending),
//   * decremented inside `markSynced` (rows are only marked synced after they
//     were previously pending),
//   * incremented inside `syncQueue.enqueue` (when the row was not already
//     pending) via the exported `bumpPendingCount` helper.
//
// Strict invariant: callers must only call `bumpPendingCount` after they have
// observed the row's pre-update `_offline` flag, otherwise the counter will
// drift away from reality.  We never go below zero defensively.
const SYNCED_TABLES = [
  "transactions",
  "categories",
  "budget_plans",
  "budget_items",
  "accounts",
  "user_preferences",
  "recurring_templates",
];


async function ensurePendingCountInit() {
  if (_pendingCountCache !== null) return _pendingCountCache;
  if (_pendingCountInit) return _pendingCountInit;
  _pendingCountInit = (async () => {
    // Rescan until a scan completes with no mutation or wipe in between;
    // otherwise a row written to an already-counted table would be missed,
    // or a pre-wipe total would be published after the wipe.
    while (_pendingCountCache === null) {
      const generation = _pendingCountGeneration;
      let total = 0;
      for (const t of SYNCED_TABLES) {
        total += await db.table(t).where("_offline").equals(1).count();
      }
      if (
        generation === _pendingCountGeneration &&
        _pendingCountCache === null
      ) {
        _pendingCountCache = total;
      }
    }
    return _pendingCountCache;
  })();
  return _pendingCountInit;
}

export function bumpPendingCount(delta) {
  if (_pendingCountCache === null) {
    // Counter not yet initialised. The Dexie write has already resolved by
    // the time callers invoke this, so a fresh scan will see it — but a scan
    // already in flight may have passed that table, so invalidate it.
    _pendingCountGeneration++;
    void ensurePendingCountInit();
    return;
  }
  _pendingCountCache = Math.max(0, _pendingCountCache + delta);
}

// ── Helper: count all pending-sync records across all tables ──
//
// First call performs the full scan; subsequent calls are O(1) reads of the
// cached counter.  Callers that only need an approximate value (e.g.
// `useSyncStatus` after a burst of inline edits) effectively pay nothing.
export async function getPendingSyncCount() {
  return ensurePendingCountInit();
}

// ── Helper: mark a record as synced (clear offline flags) ──
//
// `pushedOfflineAt` is the `_offlineAt` of the snapshot the sync engine just
// pushed. If the row was changed again while that push was in flight its
// `_offlineAt` has moved on, and the newer change has not been sent — so the
// flags are left in place and the row stays in the queue for the next push.
//
// Returns true when the row is no longer pending, false when it was kept.
export async function markSynced(tableName, id, pushedOfflineAt) {
  const table = db.table(tableName);
  const cleared = await db.transaction("rw", table, async () => {
    const row = await table.get(id);
    if (
      pushedOfflineAt !== undefined &&
      row?._offline === 1 &&
      row._offlineAt !== pushedOfflineAt
    ) {
      return false;
    }
    await table.update(id, {
      _offline: 0,
      _action: null,
      _offlineAt: null,
      ...(tableName === "categories" ? { _archiveRestore: false } : {}),
    });
    return true;
  });
  // Sync engine only calls markSynced for rows it pulled out of the offline
  // queue, so we know the row was previously pending. A row that was kept is
  // still pending and still counted.
  if (cleared) bumpPendingCount(-1);
  // No longer protected by its pending flag; a revalidation that started
  // before the push must still leave it alone.
  noteLocalWrite(tableName, [id]);
  return cleared;
}

// ── Helper: replace a pushed local row with the server row it merged into ──
//
// For natural-key tables the server may already hold the record under a
// different id (see NATURAL_KEYS). After such a push the local row takes the
// server's identity: the local id is dropped, the server row is stored, and
// for a budget plan its local items are re-pointed at the server plan id.
//
// Like `markSynced`, a row changed again while the push was in flight keeps
// its newer content and stays queued — now under the server id, as an update.
//
// Returns true when the row is no longer pending, false when it was kept.
export async function adoptServerRow(tableName, localRow, serverRow) {
  const table = db.table(tableName);
  const tables =
    tableName === "budget_plans" ? [table, db.budget_items] : [table];
  let cleared = true;
  await db.transaction("rw", ...tables, async () => {
    const current = await table.get(localRow.id);
    const changed =
      current?._offline === 1 && current._offlineAt !== localRow._offlineAt;
    cleared = !changed;
    await table.delete(localRow.id);
    await table.put(
      changed
        ? { ...current, id: serverRow.id, user_id: serverRow.user_id, _action: "update" }
        : serverRow,
    );
    if (tableName === "budget_plans") {
      const items = await db.budget_items
        .where("budget_plan_id")
        .equals(localRow.id)
        .toArray();
      if (items.length) {
        await db.budget_items.bulkPut(
          items.map((item) => ({ ...item, budget_plan_id: serverRow.id })),
        );
      }
    }
  });
  if (cleared) bumpPendingCount(-1);
  noteLocalWrite(tableName, [serverRow.id]);
  notifyTable(tableName);
  if (tableName === "budget_plans") notifyTable("budget_items");
  return cleared;
}

// ── Helper: store several records with offline flags, all or nothing ──
//
// Used for writes that span rows (both legs of a transfer, bulk edits): the
// rows and their queue flags land in one transaction, so a tab that dies
// part-way cannot leave half of the change queued.
//
// A row that is already pending keeps its queued action when the new change
// is an update, so an unsynced create is still pushed as a create.
//
// Returns the rows as stored (including their `_action`).
export async function putOfflineMany(tableName, records, action = "create") {
  if (!records.length) return [];
  const table = db.table(tableName);
  let stored = [];
  let added = 0;
  await db.transaction("rw", table, async () => {
    const priors = await table.bulkGet(records.map((r) => r.id));
    const now = new Date().toISOString();
    added = 0;
    stored = records.map((record, i) => {
      const prior = priors[i];
      const wasPending = prior?._offline === 1;
      if (!wasPending) added++;
      return {
        ...record,
        _offline: 1,
        _action:
          action === "update" && wasPending && prior._action
            ? prior._action
            : action,
        _offlineAt: now,
      };
    });
    await table.bulkPut(stored);
  });
  // Counter and listeners are touched only after the transaction commits.
  if (added) bumpPendingCount(added);
  noteLocalWrite(tableName, stored.map((r) => r.id));
  notifyTable(tableName);
  return stored;
}

// ── Helper: store a record with offline flags ──
export async function putOffline(tableName, record, action = "create") {
  // Read the existing row first so we only count this as a new pending
  // mutation if the row wasn't already in the queue.
  const prior = await db.table(tableName).get(record.id);
  const wasPending = prior?._offline === 1;
  await db.table(tableName).put({
    ...record,
    _offline: 1,
    _action: action,
    _offlineAt: new Date().toISOString(),
  });
  if (!wasPending) bumpPendingCount(1);
  noteLocalWrite(tableName, [record.id]);
  // Phase 2: tell react-query (via the bridge) that this table changed so
  // every active query keyed on it re-runs and picks up the new local row.
  notifyTable(tableName);
}

export default db;
