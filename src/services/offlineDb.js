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
  ]);
}

// ── Helper: cache a full Supabase result set into a local table ──
export async function cacheTable(tableName, rows) {
  const table = db.table(tableName);
  await table.clear();
  if (rows.length) {
    await table.bulkPut(rows);
  }
  await db.sync_meta.put({
    table_name: tableName,
    last_synced: new Date().toISOString(),
  });
}

// ── Helper: incremental cache update (Phase 1 — incremental sync) ──
//
// Used by sync.js when pulling only rows changed since the last successful
// sync. Unlike `cacheTable`, this does NOT clear the table — it only upserts
// the rows it was given and (optionally) hard-deletes ids the caller marks
// as removed. Pending offline mutations are preserved.
//
// `latestUpdatedAt` should be the max `updated_at` value across `rows`; the
// caller computes it once so we can advance the watermark correctly even when
// `rows` is empty (no-op pull → bump watermark to "now-ish").
export async function cacheTableIncremental(
  tableName,
  rows,
  { removedIds = [], latestUpdatedAt = null } = {},
) {
  const table = db.table(tableName);

  if (rows.length) {
    // Don't trample local pending mutations — those rows have `_offline === 1`.
    const pendingIds = await table.where("_offline").equals(1).primaryKeys();
    const pendingSet = new Set(pendingIds);
    const toUpsert = rows.filter((r) => !pendingSet.has(r.id));
    if (toUpsert.length) await table.bulkPut(toUpsert);
  }

  if (removedIds.length) {
    // Only delete rows that aren't in the offline-pending set.
    const pendingIds = await table.where("_offline").equals(1).primaryKeys();
    const pendingSet = new Set(pendingIds);
    const toDelete = removedIds.filter((id) => !pendingSet.has(id));
    if (toDelete.length) await table.bulkDelete(toDelete);
  }

  await db.sync_meta.put({
    table_name: tableName,
    last_synced: latestUpdatedAt || new Date().toISOString(),
  });
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

// ── Helper: count all pending-sync records across all tables ──
export async function getPendingSyncCount() {
  const tables = [
    "transactions",
    "categories",
    "budget_plans",
    "budget_items",
    "accounts",
    "user_preferences",
    "recurring_templates",
  ];
  let total = 0;
  for (const t of tables) {
    total += await db.table(t).where("_offline").equals(1).count();
  }
  return total;
}

// ── Helper: mark a record as synced (clear offline flags) ──
export async function markSynced(tableName, id) {
  await db.table(tableName).update(id, {
    _offline: 0,
    _action: null,
    _offlineAt: null,
  });
}

// ── Helper: store a record with offline flags ──
export async function putOffline(tableName, record, action = "create") {
  await db.table(tableName).put({
    ...record,
    _offline: 1,
    _action: action,
    _offlineAt: new Date().toISOString(),
  });
  // Phase 2: tell react-query (via the bridge) that this table changed so
  // every active query keyed on it re-runs and picks up the new local row.
  notifyTable(tableName);
}

export default db;
