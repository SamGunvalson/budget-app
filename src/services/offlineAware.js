/**
 * Offline-aware service wrappers.
 *
 * Each wrapper follows the same pattern:
 * - **Online writes**: call the selected backend service, then cache in IndexedDB.
 * - **Offline**: write to IndexedDB with `_offline` flags, enqueue for sync.
 * - **SWR reads**: return Dexie data immediately and revalidate in the background;
 *   await the backend on a cold online cache.
 * - Other imperative reads retain their online-first, network-error fallback.
 *
 * This keeps the original service modules untouched — all offline logic lives here.
 */
import db, {
  putOffline,
  putOfflineMany,
  cacheServerRows,
  noteLocalWrite,
  writtenSince,
  readRpcCache,
  writeRpcCache,
  clearRpcCache,
} from "./offlineDb";
import { enqueue as addToSyncQueue } from "../utils/syncQueue";
import { newId } from "../utils/ids";
import { swrRead, notifyTable } from "./cache";
import { requestSync, schedulePush } from "./sync";
import { isAvailableCategory } from "../utils/categoryArchive";

// ── SWR helpers ──
//
// Phase 1 cache-first reads: priority "hot" read functions delegate to
// `swrRead` which serves Dexie immediately and revalidates from the backend
// in the background. Helpers in this file build the (readCache, fetchFresh,
// writeCache) triple for each function while preserving the original
// signatures and return shapes so callers don't need to change.

// ── Helpers ──

export function isOnline() {
  return navigator.onLine;
}

async function assertCachedCategoryAvailable(categoryId) {
  const category = await db.categories.get(categoryId);
  if (category && !isAvailableCategory(category)) {
    throw new Error("Restore the archived category or choose another before using it.");
  }
}

// Message fragments browsers and HTTP stacks use for "the request never got
// an answer": Chrome "Failed to fetch", Safari "Load failed", Firefox
// "NetworkError when attempting to fetch resource", React Native / Capacitor
// "Network request failed", plus timeouts, aborts and gateway errors. The
// PostgREST client reports a failed fetch as a plain `{ message, code: "" }`
// object whose message starts with the original error's name, so the name
// alone cannot be relied on.
const CONNECTIVITY_MESSAGE =
  /failed to fetch|load failed|network|timed? ?out|\babort(ed)?\b|aborterror|bad gateway|service unavailable|gateway time-?out|jwt expired|invalid token/i;

/**
 * Did this error come from not reaching the backend (so the write should be
 * queued), as opposed to the backend rejecting the request (so the user must
 * see the error — queueing it would only fail again on every sync)?
 *
 * Checked in order of reliability: HTTP status, then the backend's error
 * code, then the error name, and only then the message text.
 */
export function isConnectivityError(err) {
  if (!navigator.onLine) return true;
  if (!err) return false;

  const status = typeof err.status === "number" ? err.status : null;
  // 0 = no response; 502–504 = a proxy could not reach the backend;
  // 401 = expired session, which the local cache can ride out.
  if (status === 0 || status === 401 || (status >= 502 && status <= 504)) {
    return true;
  }
  // Any other 4xx/5xx is the backend's considered answer.
  if (status !== null && status >= 400) return false;

  const code = typeof err.code === "string" ? err.code : "";
  // PGRST301 = JWT expired; PGRST000–003 = PostgREST cannot reach the database.
  if (code === "PGRST301" || /^PGRST00[0-3]$/.test(code)) return true;
  // A SQLSTATE (constraint, RLS, check violation…) or another PostgREST code
  // is a real rejection, whatever its message happens to contain.
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith("PGRST")) return false;

  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  return CONNECTIVITY_MESSAGE.test(String(err.message ?? ""));
}

/**
 * Try an async fn; if we're offline or it throws a network error,
 * return { offline: true }. Otherwise return { data }.
 */
async function tryOnline(fn) {
  if (!isOnline()) return { offline: true };
  try {
    const data = await fn();
    return { data };
  } catch (err) {
    if (isConnectivityError(err)) return { offline: true, error: err };
    throw err; // Real Supabase error — let caller handle
  }
}

async function hasPendingRows(table, ids) {
  const keys = ids.filter(Boolean);
  if (!keys.length) return false;
  const rows = await db.table(table).bulkGet(keys);
  return rows.some((row) => row?._offline === 1);
}

// How long a write waits for the queue to flush before it is queued instead.
// A sync already in flight may be in the middle of a full pull; a save should
// not hang on that.
const FLUSH_WAIT_MS = 4000;

async function flushQueue() {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(resolve, FLUSH_WAIT_MS);
  });
  try {
    await Promise.race([requestSync({ skipPull: true }), timedOut]);
  } catch {
    // A failed flush leaves the rows pending; the caller re-checks.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The single entry point for backend writes to a mirrored table. Every
 * update/delete wrapper goes through it, and so do creates that reference
 * other mirrored rows.
 *
 * A row that is still waiting to sync (`_offline === 1`) holds a change the
 * server has not seen. Writing to the backend and then caching the response
 * over that row would drop the queued change; for an unsynced create the
 * backend write fails because the row does not exist there yet; and a write
 * that references an unsynced account or category fails its foreign key. So
 * when any target or referenced row is pending:
 *
 *  1. flush the queue first (push only, bounded wait), which also creates
 *     unsynced rows;
 *  2. if one is still pending afterwards (offline, slow, or its push failed),
 *     report `{ offline: true }` so the caller takes its queued path and
 *     merges the new change into the pending row instead of overwriting it.
 *     Queued rows are pushed in dependency order, and `enqueue` schedules
 *     that push when the app is online.
 *
 * Otherwise this behaves exactly like `tryOnline`.
 *
 * @param {string} table — mirrored table name
 * @param {string[]} ids — primary keys of the existing rows the write touches
 * @param {() => Promise<any>} fn — the backend write
 * @param {Record<string, string[]>} [refs] — rows in other tables the write
 *   references, as `{ tableName: ids }`
 */
async function tryOnlineWrite(table, ids, fn, refs = {}) {
  const targets = [[table, ids], ...Object.entries(refs)];
  const anyPending = async () => {
    for (const [name, keys] of targets) {
      if (await hasPendingRows(name, keys)) return true;
    }
    return false;
  };

  if (await anyPending()) {
    if (!isOnline()) return { offline: true };
    await flushQueue();
    if (await anyPending()) return { offline: true, pending: true };
  }
  return tryOnline(fn);
}

/**
 * Flag a locally written row for sync. Every queued write goes through here.
 * When the app is online the queued change would otherwise wait for the next
 * `online` or tab-visibility event, so ask the sync engine for a push shortly
 * afterwards.
 */
async function enqueue(table, id, action) {
  await addToSyncQueue(table, id, action);
  // Server-computed values no longer include this change (see `rpcRead`).
  await clearRpcCache();
  if (isOnline()) schedulePush();
}

/**
 * Store locally changed rows as pending and queue them for sync, all or
 * nothing. A row that is already pending keeps its queued action when the
 * new change is an update, so an unsynced create is still pushed as a create.
 */
async function queueRows(table, rows, action) {
  const stored = await putOfflineMany(table, rows, action);
  for (const row of stored) await enqueue(table, row.id, row._action);
}

/**
 * Mirror rows returned by a backend write into Dexie. A row that became
 * pending while the backend call was in flight is left alone: it holds a
 * newer local change that is still queued, and overwriting it would clear
 * its flags and drop that change.
 */
async function cacheWritten(table, rows) {
  await cacheServerRows(table, rows);
  notifyTable(table);
}

/**
 * Attach the `categories` / `accounts` join objects that backend reads
 * return, built from the live local tables.
 *
 * The join stored on a cached row is a snapshot from when the row was
 * fetched. The local tables are newer whenever a category or account was
 * renamed, recoloured or retyped, or the row was moved to another one, so
 * they take precedence. The stored join is only a fallback for a row whose
 * category or account is not mirrored (e.g. deactivated), and only while it
 * still describes the id the row points at.
 *
 * Every cache read that returns joined rows goes through this.
 */
async function attachJoins(rows, { accounts = true } = {}) {
  const cats = Object.fromEntries(
    (await db.categories.toArray()).map((c) => [
      c.id,
      { id: c.id, name: c.name, color: c.color, type: c.type },
    ]),
  );
  const accts = accounts
    ? Object.fromEntries(
        (await db.accounts.toArray()).map((a) => [
          a.id,
          { id: a.id, name: a.name, type: a.type },
        ]),
      )
    : null;
  const stored = (join, id) => (join && join.id === id ? join : null);
  return rows.map((r) => {
    const next = {
      ...r,
      categories:
        cats[r.category_id] || stored(r.categories, r.category_id) || null,
    };
    if (accts) {
      next.accounts =
        accts[r.account_id] || stored(r.accounts, r.account_id) || null;
    }
    return next;
  });
}

// ── RPC-derived reads (balances, plan vs actual, trends, years) ──
//
// `rpc_cache` holds what the server computed. Two rules keep it honest:
//
//  * only a value that really came from the server is stored. When the
//    backend call fails, `fetchFresh` answers with a fold over the local
//    tables so the screen is not blank, but that fold is not the server's
//    answer and must not be served later as if it were;
//  * a queued local write makes every stored value stale, so `enqueue`
//    clears the cache. Until the server can be asked again, reads fall back
//    to the local fold, which includes the queued change.
const serverResults = new WeakSet();

/** Mark a value as the backend's own answer (see `writeServerRpcCache`). */
function fromServer(value) {
  if (value !== null && typeof value === "object") serverResults.add(value);
  return value;
}

function isFromServer(value) {
  return value !== null && typeof value === "object" && serverResults.has(value);
}

async function writeServerRpcCache(key, value) {
  if (isFromServer(value)) await writeRpcCache(key, value);
}

/**
 * SWR read of an RPC-derived value. `fetchFresh` returns
 * `fromServer(result)` when the backend answered and the local fold
 * otherwise. Offline with nothing stored, the fold is what is shown.
 */
function rpcRead({ key, fetchFresh, ...rest }) {
  return swrRead({
    isEmpty: (v) => v == null,
    ...rest,
    key,
    fetchFresh,
    readCache: async () =>
      (await readRpcCache(key)) ?? (isOnline() ? null : fetchFresh()),
    writeCache: (value) => writeServerRpcCache(key, value),
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════════════════════════════

import {
  getTransactions as _getTransactions,
  createTransaction as _createTransaction,
  updateTransaction as _updateTransaction,
  deleteTransaction as _deleteTransaction,
  createAdjustment as _createAdjustment,
  createTransfer as _createTransfer,
  updateTransfer as _updateTransfer,
  createLinkedTransfer as _createLinkedTransfer,
  updateLinkedTransfer as _updateLinkedTransfer,
  createAsymmetricTransfer as _createAsymmetricTransfer,
  updateAsymmetricTransfer as _updateAsymmetricTransfer,
  bulkUpdateTransactions as _bulkUpdateTransactions,
  bulkConfirmTransactions as _bulkConfirmTransactions,
  bulkSkipTransactions as _bulkSkipTransactions,
  getTransactionsYTD as _getTransactionsYTD,
  getTransactionsForYear as _getTransactionsForYear,
  getPendingReviewCount as _getPendingReviewCount,
} from "./transactions";

/**
 * Fetch transactions — cache-first SWR.
 *
 * Returns cached rows from IndexedDB immediately. If we're online, kicks a
 * background Supabase fetch that updates the cache and notifies
 * subscribers (`subscribeTable('transactions', …)`). On a cold cache the
 * Supabase fetch is awaited so the first paint has data.
 */
export async function getTransactionsOffline(filters = {}) {
  return swrRead({
    key: `transactions:${filters.month ?? ""}-${filters.year ?? ""}-${filters.status ?? ""}`,
    table: "transactions",
    readCache: () => readTransactionsFromCache(filters),
    fetchFresh: () => _getTransactions(filters),
    writeCache: (rows, meta) => cacheTransactions(rows, filters, meta),
  });
}

async function readTransactionsFromCache(filters = {}) {
  let rows = await db.transactions.toArray();
  rows = rows.filter((r) => !r.deleted_at);

  if (filters.month && filters.year) {
    const startDate = `${filters.year}-${String(filters.month).padStart(2, "0")}-01`;
    const endMonth = filters.month === 12 ? 1 : filters.month + 1;
    const endYear = filters.month === 12 ? filters.year + 1 : filters.year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
    rows = rows.filter(
      (r) => r.transaction_date >= startDate && r.transaction_date < endDate,
    );
  }
  if (filters.status && filters.status !== "all") {
    rows = rows.filter((r) => r.status === filters.status);
  }

  // Attach cached category/account joins so the shape matches Supabase output.
  // (Without this, components that read tx.categories.color crash on the
  // first paint when the row was written by a non-joining mutation path.)
  rows = await attachJoins(rows);

  // Sort newest first
  rows.sort((a, b) =>
    (b.transaction_date || "").localeCompare(a.transaction_date || ""),
  );
  return rows;
}

function inDateRange(date, startInclusive, endExclusive) {
  return date >= startInclusive && date < endExclusive;
}

function matchesTransactionScope(tx, filters = {}) {
  if (!tx?.transaction_date) return false;

  if (filters.month && filters.year) {
    const startDate = `${filters.year}-${String(filters.month).padStart(2, "0")}-01`;
    const endMonth = filters.month === 12 ? 1 : filters.month + 1;
    const endYear = filters.month === 12 ? filters.year + 1 : filters.year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
    if (!inDateRange(tx.transaction_date, startDate, endDate)) return false;
  } else if (filters.year && filters.throughMonth) {
    const startDate = `${filters.year}-01-01`;
    const endMonth = filters.throughMonth === 12 ? 1 : filters.throughMonth + 1;
    const endYear =
      filters.throughMonth === 12 ? filters.year + 1 : filters.year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
    if (!inDateRange(tx.transaction_date, startDate, endDate)) return false;
  } else if (filters.year) {
    const startDate = `${filters.year}-01-01`;
    const endDate = `${filters.year + 1}-01-01`;
    if (!inDateRange(tx.transaction_date, startDate, endDate)) return false;
  }

  if (
    filters.status &&
    filters.status !== "all" &&
    tx.status !== filters.status
  ) {
    return false;
  }

  return true;
}

async function cacheTransactions(data, filters = {}, { fetchStartedAt } = {}) {
  // Don't wipe the whole table — only upsert fetched rows to preserve offline-pending ones
  const pending = await db.transactions
    .where("_offline")
    .equals(1)
    .primaryKeys();
  const pendingSet = new Set(pending);
  // A row written locally after this fetch was issued (created or edited by
  // the user, pushed by sync, or pulled) is newer than the response: the
  // response can neither replace it nor prove that it was deleted.
  const isNewer = (id) =>
    fetchStartedAt != null && writtenSince("transactions", id, fetchStartedAt);
  const toCache = data.filter((r) => !pendingSet.has(r.id) && !isNewer(r.id));
  if (toCache.length) {
    await db.transactions.bulkPut(toCache);
    noteLocalWrite("transactions", toCache.map((r) => r.id));
  }

  // Reconcile stale rows for this fetch scope so soft-deleted rows removed on
  // the server don't linger locally and appear as duplicates.
  const freshIds = new Set(data.map((r) => r.id));
  const local = await db.transactions.toArray();
  const staleIds = local
    .filter(
      (row) =>
        matchesTransactionScope(row, filters) &&
        !pendingSet.has(row.id) &&
        !freshIds.has(row.id) &&
        !isNewer(row.id),
    )
    .map((row) => row.id);
  if (staleIds.length) await db.transactions.bulkDelete(staleIds);
}

// ── Transaction write helpers ──
//
// Every transaction write below follows one shape: `tryOnlineWrite` (or
// `tryOnline` for creates) performs the backend call and the result is
// mirrored into Dexie; otherwise the same change is applied to Dexie through
// `queueRows` so sync replays it row by row.

/**
 * Refresh a transaction's display joins from the local cache. A stored join
 * that describes a different category / account than the row now points at
 * is dropped rather than left stale.
 */
async function withLocalJoins(row) {
  const next = { ...row };
  const cat = row.category_id ? await db.categories.get(row.category_id) : null;
  if (cat) {
    next.categories = {
      id: cat.id,
      name: cat.name,
      color: cat.color,
      type: cat.type,
    };
  } else if (next.categories && next.categories.id !== row.category_id) {
    next.categories = null;
  }
  const acct = row.account_id ? await db.accounts.get(row.account_id) : null;
  if (acct) {
    next.accounts = { id: acct.id, name: acct.name, type: acct.type };
  } else if (next.accounts && next.accounts.id !== row.account_id) {
    next.accounts = null;
  }
  return next;
}

/** Live local legs sharing a transaction's transfer_group_id (itself included). */
async function getLocalTransferLegs(id) {
  const existing = await db.transactions.get(id);
  if (!existing) return { existing: null, legs: [] };
  if (!existing.transfer_group_id) return { existing, legs: [existing] };
  const legs = await db.transactions
    .where("transfer_group_id")
    .equals(existing.transfer_group_id)
    .filter((tx) => !tx.deleted_at)
    .toArray();
  return { existing, legs };
}

/** Shape the account / category ids a transaction write references. */
function transactionRefs(...sources) {
  const accounts = [];
  const categories = [];
  for (const source of sources) {
    if (!source) continue;
    accounts.push(
      source.account_id,
      source.from_account_id,
      source.to_account_id,
      source.linked_account_id,
    );
    categories.push(source.category_id);
  }
  return { accounts, categories };
}

/** Queue brand-new transaction rows (already carrying their ids). */
async function queueNewTransactions(rows) {
  const queued = [];
  for (const row of rows) {
    queued.push(
      await withLocalJoins({
        user_id: null, // Filled on sync
        payee: null,
        status: "posted",
        transfer_group_id: null,
        recurring_template_id: null,
        deleted_at: null,
        categories: null,
        accounts: null,
        ...row,
      }),
    );
  }
  // One transaction for all rows: a transfer is never queued with one leg.
  await queueRows("transactions", queued, "create");
  return queued;
}

/** Queue an update to existing local transaction rows; returns the new rows. */
async function queueTransactionUpdates(changes) {
  const now = new Date().toISOString();
  const queued = [];
  for (const { row, fields } of changes) {
    queued.push(await withLocalJoins({ ...row, ...fields, updated_at: now }));
  }
  await queueRows("transactions", queued, "update");
  return queued;
}

/** Queue a soft-delete of existing local transaction rows. */
async function queueTransactionDeletes(rows) {
  const now = new Date().toISOString();
  await queueRows(
    "transactions",
    rows.map((row) => ({ ...row, deleted_at: now })),
    "delete",
  );
  return rows.map((row) => row.id);
}

/** Mirror backend-returned transaction rows into Dexie. */
async function cacheWrittenTransactions(rows) {
  await cacheWritten("transactions", rows);
}

/** Mirror backend soft-deletes into Dexie. */
async function cacheDeletedTransactions(ids) {
  const now = new Date().toISOString();
  for (const id of ids) {
    await db.transactions.update(id, { deleted_at: now });
  }
  notifyTable("transactions");
}

async function createSingleTransaction(txData, createOnline) {
  await assertCachedCategoryAvailable(txData.category_id);
  const id = newId();
  const result = await tryOnlineWrite(
    "transactions",
    [],
    () => createOnline({ ...txData, id }),
    transactionRefs(txData),
  );

  if (!result.offline) {
    await cacheWritten("transactions", [result.data]);
    return result.data;
  }

  // Offline (or the response was lost): queue the row under the same id
  const now = new Date().toISOString();
  const [row] = await queueNewTransactions([
    {
      id,
      account_id: txData.account_id,
      category_id: txData.category_id,
      amount: txData.amount,
      description: txData.description?.trim() ?? "",
      payee: txData.payee?.trim() || null,
      transaction_date: txData.transaction_date,
      is_income: txData.is_income,
      status: txData.status || "posted",
      transfer_group_id: txData.transfer_group_id || null,
      recurring_template_id: txData.recurring_template_id || null,
      created_at: now,
      updated_at: now,
    },
  ]);
  return row;
}

/**
 * Create a transaction — dual-write when online, IndexedDB-only when offline.
 */
export async function createTransactionOffline(txData) {
  return createSingleTransaction(txData, _createTransaction);
}

/**
 * Create a single-account balance adjustment (one row, no transfer group).
 */
export async function createAdjustmentOffline(values) {
  return createSingleTransaction(
    { ...values, recurring_template_id: null, transfer_group_id: null },
    _createAdjustment,
  );
}

/**
 * Update a transaction — dual-write when online, IndexedDB-only when offline.
 */
export async function updateTransactionOffline(id, updates) {
  if (updates.category_id) {
    const existing = await db.transactions.get(id);
    if (existing?.category_id !== updates.category_id) {
      await assertCachedCategoryAvailable(updates.category_id);
    }
  }
  const result = await tryOnlineWrite(
    "transactions",
    [id],
    () => _updateTransaction(id, updates),
    transactionRefs(updates),
  );

  if (!result.offline) {
    await cacheWritten("transactions", [result.data]);
    return result.data;
  }

  // Offline: update locally
  const existing = await db.transactions.get(id);
  if (!existing) throw new Error(`Transaction ${id} not found locally`);

  const updated = await withLocalJoins({
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  });
  await putOffline(
    "transactions",
    updated,
    existing._offline ? existing._action : "update",
  );
  await enqueue(
    "transactions",
    id,
    existing._offline ? existing._action : "update",
  );
  return updated;
}

/**
 * Update a single-account balance adjustment (a plain transaction update).
 */
export async function updateAdjustmentOffline(id, updates) {
  return updateTransactionOffline(id, updates);
}

/**
 * Delete (soft-delete) a transaction.
 */
export async function deleteTransactionOffline(id) {
  // Mirrors the service: a transfer's live companion legs (same
  // transfer_group_id) are deleted with it, because sync replays one
  // soft-delete RPC per queued row and never runs the companion lookup.
  const { existing, legs } = await getLocalTransferLegs(id);
  const targets = existing
    ? [existing, ...legs.filter((tx) => tx.id !== id)]
    : [];

  const result = await tryOnlineWrite(
    "transactions",
    [id, ...targets.map((tx) => tx.id)],
    () => _deleteTransaction(id),
  );

  if (!result.offline) {
    // Mark deleted locally too. The service returns every id it deleted —
    // for a transfer that includes the companion leg.
    await cacheDeletedTransactions(result.data?.length ? result.data : [id]);
    return result.data;
  }

  // Offline soft-delete
  if (!targets.length) return [id];
  return queueTransactionDeletes(targets);
}

/**
 * Bulk soft-delete transactions (each with its transfer companions).
 *
 * @param {string[]} ids
 * @returns {Promise<string[]>} every id that was deleted
 */
export async function bulkDeleteTransactionsOffline(ids) {
  const targets = new Map();
  for (const id of ids) {
    const { existing, legs } = await getLocalTransferLegs(id);
    if (existing) targets.set(existing.id, existing);
    for (const leg of legs) targets.set(leg.id, leg);
  }

  const result = await tryOnlineWrite(
    "transactions",
    [...ids, ...targets.keys()],
    () => Promise.all(ids.map((id) => _deleteTransaction(id))),
  );

  if (!result.offline) {
    const deleted = [...new Set(result.data.flat())];
    await cacheDeletedTransactions(deleted);
    return deleted;
  }

  return queueTransactionDeletes([...targets.values()]);
}

/**
 * Skip (soft-delete) one projected or pending transaction. Like the service,
 * this touches only the given row — no companion lookup.
 *
 * @returns {Promise<string>} the skipped id
 */
export async function skipTransactionOffline(id) {
  const [skipped] = await bulkSkipTransactionsOffline([id]);
  return skipped;
}

/**
 * Bulk-skip (soft-delete) projected or pending transactions.
 *
 * @param {string[]} ids
 * @returns {Promise<string[]>} the skipped ids
 */
export async function bulkSkipTransactionsOffline(ids) {
  const result = await tryOnlineWrite("transactions", ids, () =>
    _bulkSkipTransactions(ids),
  );

  if (!result.offline) {
    await cacheDeletedTransactions(ids);
    return ids;
  }

  const rows = (await db.transactions.bulkGet(ids)).filter(Boolean);
  await queueTransactionDeletes(rows);
  return ids;
}

/**
 * Confirm a pending transaction → posted.
 *
 * @returns {Promise<Object>} the updated transaction
 */
export async function confirmTransactionOffline(id) {
  const [confirmed] = await bulkConfirmTransactionsOffline([id]);
  if (!confirmed) throw new Error(`Transaction ${id} not found locally`);
  return confirmed;
}

/**
 * Bulk-confirm pending transactions → posted.
 *
 * @param {string[]} ids
 * @returns {Promise<Object[]>} the updated transactions
 */
export async function bulkConfirmTransactionsOffline(ids) {
  const result = await tryOnlineWrite("transactions", ids, () =>
    _bulkConfirmTransactions(ids),
  );

  if (!result.offline) {
    await cacheWrittenTransactions(result.data);
    return result.data;
  }

  const rows = (await db.transactions.bulkGet(ids)).filter(
    (row) => row && !row.deleted_at,
  );
  return queueTransactionUpdates(
    rows.map((row) => ({ row, fields: { status: "posted" } })),
  );
}

// Columns `bulk_update_transactions` honours; anything else is ignored there.
const BULK_UPDATE_FIELDS = [
  "account_id",
  "category_id",
  "amount",
  "description",
  "payee",
  "transaction_date",
  "is_income",
  "status",
];

/**
 * Bulk-update transactions. Each item is `{ id, ...fields }`; fields that are
 * absent or undefined are left alone.
 *
 * @param {Array<{id: string, [key: string]: any}>} updates
 * @returns {Promise<Object[]>} the updated transactions
 */
export async function bulkUpdateTransactionsOffline(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return [];

  const result = await tryOnlineWrite(
    "transactions",
    updates.map((u) => u.id),
    () => _bulkUpdateTransactions(updates),
    transactionRefs(...updates),
  );

  if (!result.offline) {
    await cacheWrittenTransactions(result.data);
    return result.data;
  }

  // Offline: apply the same field semantics the RPC uses, row by row.
  const changes = [];
  for (const { id, ...input } of updates) {
    const row = await db.transactions.get(id);
    if (!row || row.deleted_at) continue; // the RPC skips missing/deleted rows
    const fields = {};
    for (const key of BULK_UPDATE_FIELDS) {
      const value = input[key];
      if (value === undefined) continue;
      if (key === "description") {
        fields[key] = typeof value === "string" ? value.trim() : (value ?? "");
      } else if (key === "payee") {
        fields[key] = (typeof value === "string" ? value.trim() : value) || null;
      } else {
        fields[key] = value;
      }
    }
    changes.push({ row, fields });
  }
  return queueTransactionUpdates(changes);
}

// Ids for a new two-row transfer, chosen before the backend is tried.
function newTransferIds() {
  return {
    transfer_group_id: newId(),
    outgoing_id: newId(),
    incoming_id: newId(),
  };
}

// Build the two rows of a transfer for the queued path.
function buildTransferLegs({
  from_account_id,
  to_account_id,
  from_amount,
  to_amount,
  description,
  payee,
  transaction_date,
  category_id,
  status,
  transfer_group_id,
  outgoing_id,
  incoming_id,
}) {
  const now = new Date().toISOString();
  const base = {
    category_id,
    description: description?.trim() ?? "",
    payee: payee?.trim() || null,
    transaction_date,
    transfer_group_id,
    status: status || "posted",
    created_at: now,
    updated_at: now,
  };
  return [
    {
      ...base,
      id: outgoing_id,
      account_id: from_account_id,
      amount: from_amount,
      is_income: false,
    },
    {
      ...base,
      id: incoming_id,
      account_id: to_account_id,
      amount: to_amount,
      is_income: true,
    },
  ];
}

/**
 * Create both legs of a same-amount transfer between two accounts.
 *
 * @param {Object} params - same shape accepted by createTransfer
 * @returns {Promise<Object[]>} [outgoing, incoming]
 */
export async function createTransferOffline(params) {
  await assertCachedCategoryAvailable(params.category_id);
  const ids = newTransferIds();
  const result = await tryOnlineWrite(
    "transactions",
    [],
    () => _createTransfer({ ...params, ...ids }),
    transactionRefs(params),
  );

  if (!result.offline) {
    await cacheWrittenTransactions(result.data);
    return result.data;
  }

  return queueNewTransactions(
    buildTransferLegs({
      ...params,
      ...ids,
      from_amount: params.amount,
      to_amount: params.amount,
      status: undefined, // createTransfer does not take a status
    }),
  );
}

/**
 * Create both legs of an asymmetric transfer — dual-write when online,
 * IndexedDB-only when offline.
 *
 * @param {Object} params - same shape accepted by createAsymmetricTransfer
 * @returns {Promise<Object[]>} [outgoing, incoming]
 */
export async function createAsymmetricTransferOffline(params) {
  await assertCachedCategoryAvailable(params.category_id);
  const ids = newTransferIds();
  const result = await tryOnlineWrite(
    "transactions",
    [],
    () => _createAsymmetricTransfer({ ...params, ...ids }),
    transactionRefs(params),
  );

  if (!result.offline) {
    await cacheWrittenTransactions(result.data);
    return result.data;
  }

  return queueNewTransactions(buildTransferLegs({ ...params, ...ids }));
}

// The companion leg of a linked transfer always uses the user's
// "Account Transfer" category (type 'transfer'), as in the service.
async function findLocalTransferCategoryId() {
  const categories = await db.categories.toArray();
  const match = categories.find(
    (cat) =>
      cat.type === "transfer" &&
      cat.name?.toLowerCase() === "account transfer" &&
      isAvailableCategory(cat),
  );
  if (!match) {
    throw new Error(
      'No available "Account Transfer" category found. Create or restore it in Categories.',
    );
  }
  return match.id;
}

/**
 * Create a linked transfer: a budget-impacting main leg plus a neutral
 * companion leg on the linked account.
 *
 * @param {Object} params - same shape accepted by createLinkedTransfer
 * @returns {Promise<Object[]>} [mainLeg, companionLeg]
 */
export async function createLinkedTransferOffline(params) {
  await assertCachedCategoryAvailable(params.category_id);
  const ids = { transfer_group_id: newId(), id: newId(), companion_id: newId() };
  const result = await tryOnlineWrite(
    "transactions",
    [],
    () => _createLinkedTransfer({ ...params, ...ids }),
    transactionRefs(params),
  );

  if (!result.offline) {
    await cacheWrittenTransactions(result.data);
    return result.data;
  }

  const { amount, companion_amount, is_income } = params;
  const companionCategoryId = await findLocalTransferCategoryId();
  const now = new Date().toISOString();
  const shared = {
    description: params.description?.trim() ?? "",
    payee: params.payee?.trim() || null,
    transaction_date: params.transaction_date,
    transfer_group_id: ids.transfer_group_id,
    created_at: now,
    updated_at: now,
  };
  return queueNewTransactions([
    {
      ...shared,
      id: ids.id,
      account_id: params.account_id,
      category_id: params.category_id,
      is_income,
      amount,
    },
    {
      ...shared,
      id: ids.companion_id,
      account_id: params.linked_account_id,
      category_id: companionCategoryId,
      is_income: !is_income,
      amount:
        companion_amount != null && companion_amount !== amount
          ? companion_amount
          : amount,
    },
  ]);
}

// Shared by the two-leg transfer updates: run the backend update unless a leg
// is pending, otherwise queue the per-leg changes `planLocal` works out.
async function updateTransferLegs(id, updates, updateOnline, planLocal) {
  const { existing, legs } = await getLocalTransferLegs(id);
  // As in updateTransactionOffline: a category the transfer does not already
  // use must still be available (not archived or deleted).
  if (
    updates.category_id &&
    !legs.some((leg) => leg.category_id === updates.category_id)
  ) {
    await assertCachedCategoryAvailable(updates.category_id);
  }
  const result = await tryOnlineWrite(
    "transactions",
    [id, ...legs.map((leg) => leg.id)],
    updateOnline,
    transactionRefs(updates),
  );

  if (!result.offline) {
    await cacheWrittenTransactions(result.data);
    return result.data;
  }

  // Offline: resolve both legs from Dexie via transfer_group_id
  if (!existing) throw new Error(`Transaction ${id} not found locally`);
  if (!existing.transfer_group_id)
    throw new Error("Transaction is not part of a transfer.");
  if (legs.length < 2) throw new Error("Transfer companion not found locally.");

  return queueTransactionUpdates(await planLocal(legs));
}

function planOutgoingIncoming(legs, updates) {
  const outgoingLeg = legs.find((l) => !l.is_income);
  const incomingLeg = legs.find((l) => l.is_income);
  if (!outgoingLeg || !incomingLeg)
    throw new Error("Transfer legs are malformed.");

  const shared = {
    category_id: updates.category_id,
    description: updates.description?.trim() ?? "",
    payee: updates.payee?.trim() || null,
    transaction_date: updates.transaction_date,
  };
  return [
    {
      row: outgoingLeg,
      fields: {
        ...shared,
        account_id: updates.from_account_id,
        amount: updates.from_amount,
      },
    },
    {
      row: incomingLeg,
      fields: {
        ...shared,
        account_id: updates.to_account_id,
        amount: updates.to_amount,
      },
    },
  ];
}

/**
 * Update both legs of a same-amount transfer.
 *
 * @param {string} id - ID of either leg of the transfer
 * @param {Object} updates - same shape accepted by updateTransfer
 * @returns {Promise<Object[]>} [updatedOutgoing, updatedIncoming]
 */
export async function updateTransferOffline(id, updates) {
  return updateTransferLegs(
    id,
    updates,
    () => _updateTransfer(id, updates),
    (legs) =>
      planOutgoingIncoming(legs, {
        ...updates,
        from_amount: updates.amount,
        to_amount: updates.amount,
      }),
  );
}

/**
 * Update both legs of an asymmetric transfer — dual-write when online,
 * IndexedDB-only when offline.
 *
 * @param {string} id - ID of either leg of the transfer
 * @param {Object} updates - same shape accepted by updateAsymmetricTransfer
 * @returns {Promise<Object[]>} [updatedOutgoing, updatedIncoming]
 */
export async function updateAsymmetricTransferOffline(id, updates) {
  return updateTransferLegs(
    id,
    updates,
    () => _updateAsymmetricTransfer(id, updates),
    (legs) => planOutgoingIncoming(legs, updates),
  );
}

/**
 * Update both legs of a linked transfer. The main leg keeps the user's
 * category; the companion keeps its transfer category.
 *
 * @param {string} id - ID of either leg
 * @param {Object} updates - same shape accepted by updateLinkedTransfer
 * @returns {Promise<Object[]>} [updatedMain, updatedCompanion]
 */
export async function updateLinkedTransferOffline(id, updates) {
  return updateTransferLegs(
    id,
    updates,
    () => _updateLinkedTransfer(id, updates),
    async (legs) => {
      // Main leg = non-transfer category, companion = transfer category.
      const typed = [];
      for (const leg of legs) {
        const cat = await db.categories.get(leg.category_id);
        typed.push({ leg, type: cat?.type ?? leg.categories?.type });
      }
      const mainLeg = typed.find((t) => t.type !== "transfer")?.leg;
      const companionLeg = typed.find((t) => t.type === "transfer")?.leg;
      if (!mainLeg || !companionLeg)
        throw new Error("Linked transfer legs are malformed.");

      const { amount, companion_amount, is_income } = updates;
      const shared = {
        description: updates.description?.trim() || "",
        payee: updates.payee?.trim() || null,
        transaction_date: updates.transaction_date,
      };
      return [
        {
          row: mainLeg,
          fields: {
            ...shared,
            amount,
            account_id: updates.account_id,
            category_id: updates.category_id,
            is_income,
          },
        },
        {
          row: companionLeg,
          fields: {
            ...shared,
            amount:
              companion_amount != null && companion_amount !== amount
                ? companion_amount
                : amount,
            account_id: updates.linked_account_id,
            is_income: !is_income,
          },
        },
      ];
    },
  );
}

/**
 * Fetch YTD transactions — cache-first SWR.
 */
export async function getTransactionsYTDOffline({ year, throughMonth }) {
  return swrRead({
    key: `transactions:ytd:${year}:${throughMonth}`,
    table: "transactions",
    readCache: () => readTransactionsYTDFromCache({ year, throughMonth }),
    fetchFresh: () => _getTransactionsYTD({ year, throughMonth }),
    writeCache: (rows, meta) =>
      cacheTransactions(rows, { year, throughMonth }, meta),
  });
}

async function readTransactionsYTDFromCache({ year, throughMonth }) {
  const startDate = `${year}-01-01`;
  const endMonth = throughMonth === 12 ? 1 : throughMonth + 1;
  const endYear = throughMonth === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  let rows = await db.transactions.toArray();
  rows = rows.filter(
    (r) =>
      !r.deleted_at &&
      r.transaction_date >= startDate &&
      r.transaction_date < endDate,
  );

  rows = await attachJoins(rows);

  rows.sort((a, b) =>
    (b.transaction_date || "").localeCompare(a.transaction_date || ""),
  );
  return rows;
}

/**
 * Fetch all transactions for a full year — cache-first SWR.
 */
export async function getTransactionsForYearOffline({ year }) {
  return swrRead({
    key: `transactions:year:${year}`,
    table: "transactions",
    readCache: () => readTransactionsForYearFromCache({ year }),
    fetchFresh: () => _getTransactionsForYear({ year }),
    writeCache: (rows, meta) => cacheTransactions(rows, { year }, meta),
  });
}

async function readTransactionsForYearFromCache({ year }) {
  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;

  let rows = await db.transactions.toArray();
  rows = rows.filter(
    (r) =>
      !r.deleted_at &&
      r.transaction_date >= startDate &&
      r.transaction_date < endDate,
  );

  rows = await attachJoins(rows);

  rows.sort((a, b) =>
    (b.transaction_date || "").localeCompare(a.transaction_date || ""),
  );
  return rows;
}

/**
 * Get pending review count — Supabase first, fall back to IndexedDB.
 */
export async function getPendingReviewCountOffline() {
  const result = await tryOnline(() => _getPendingReviewCount());
  if (!result.offline) return result.data;

  // Offline: count from local cache
  const rows = await db.transactions.toArray();
  return rows.filter((r) => !r.deleted_at && r.status === "pending").length;
}

// ══════════════════════════════════════════════════════════════════════════════
// ACCOUNTS
// ══════════════════════════════════════════════════════════════════════════════

import {
  getAccounts as _getAccounts,
  createAccount as _createAccount,
  updateAccount as _updateAccount,
  deleteAccount as _deleteAccount,
  getAccountBalances as _getAccountBalances,
  getNetWorthHistory as _getNetWorthHistory,
  getMaxProjectedDate as _getMaxProjectedDate,
  closeAccount as _closeAccount,
  reopenAccount as _reopenAccount,
  isAssetAccount,
  getAccountBalanceHistory as _getAccountBalanceHistory,
  getUpcomingTransactions as _getUpcomingTransactions,
} from "./accounts";

export async function getAccountsOffline() {
  return swrRead({
    key: "accounts:all",
    table: "accounts",
    readCache: () => readAccountsFromCache(),
    fetchFresh: () => _getAccounts(),
    writeCache: (rows) => cacheAccountsHelper(rows),
  });
}

async function readAccountsFromCache() {
  let rows = await db.accounts.toArray();
  rows = rows.filter((r) => r.is_active !== false);
  rows.sort(
    (a, b) =>
      (a.type || "").localeCompare(b.type || "") ||
      (a.name || "").localeCompare(b.name || ""),
  );
  return rows;
}

async function cacheAccountsHelper(data) {
  const pending = await db.accounts.where("_offline").equals(1).primaryKeys();
  const pendingSet = new Set(pending);
  const toCache = data.filter((r) => !pendingSet.has(r.id));
  if (toCache.length) await db.accounts.bulkPut(toCache);
}

/**
 * Fetch account balances — cache-first SWR.
 *
 * Both online (Supabase RPC) and offline (local compute) paths return the
 * same shape: account rows enriched with `balance`, `pending_net`,
 * `projected_balance`, `transaction_net`, `is_asset`.
 *
 * The authoritative Supabase result (including computed balance fields) is
 * stored in `rpc_cache` so subsequent reads on any device always serve the
 * correct server-computed balances rather than a local recomputation from a
 * potentially incomplete Dexie transactions table.  The local
 * `computeAccountBalancesFromCache` path is kept as a genuine offline
 * fallback only.
 *
 * `table: 'accounts'` lets swrRead call notifyTable after a background
 * refresh so React Query re-renders with the fresh data.  This does not
 * produce an infinite loop: after the first notification React Query
 * refetches, the second bg-fetch returns identical data, shallowEqualData
 * returns true, and no further notification is emitted.
 */
export async function getAccountBalancesOffline({ projectedToDate } = {}) {
  const cacheKey = `account_balances:${projectedToDate ?? "all"}`;
  return swrRead({
    key: cacheKey,
    table: "accounts",
    readCache: async () => {
      // Prefer the authoritative RPC result written by a prior online fetch.
      const rpc = await readRpcCache(cacheKey);
      if (rpc) return rpc;
      // Cold rpc_cache — fall back to local computation so the UI isn't blank
      // while the first online fetch is in flight.
      return computeAccountBalancesFromCache({ projectedToDate });
    },
    fetchFresh: async () => {
      const result = await tryOnline(() =>
        _getAccountBalances({ projectedToDate }),
      );
      if (!result.offline) return fromServer(result.data);
      // Genuinely offline — compute from whatever transactions are in Dexie.
      return computeAccountBalancesFromCache({ projectedToDate });
    },
    writeCache: async (rows) => {
      // A local fold (backend unreachable) is not the server's answer.
      if (!isFromServer(rows)) return;
      // Store the full result (including computed balance fields) in rpc_cache
      // so subsequent readCache calls serve the correct server-computed values.
      await writeRpcCache(cacheKey, rows);
      // Also write raw account metadata to db.accounts so the offline fallback
      // (computeAccountBalancesFromCache) has up-to-date starting_balance / type.
      const COMPUTED = [
        "transaction_net",
        "balance",
        "pending_net",
        "projected_balance",
        "is_asset",
      ];
      await cacheAccountsHelper(
        rows.map((row) => {
          const clean = { ...row };
          for (const k of COMPUTED) delete clean[k];
          return clean;
        }),
      );
    },
  });
}

async function computeAccountBalancesFromCache({ projectedToDate } = {}) {
  let accounts = await db.accounts.toArray();
  accounts = accounts.filter((a) => a.is_active !== false);
  if (!accounts.length) return [];

  // Today's date string — intentionally UTC so this offline fold matches the
  // get_account_balances RPC, which anchors on Postgres CURRENT_DATE.
  const now = new Date();
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

  const allTx = await db.transactions.toArray();
  const netByAccount = {};

  for (const tx of allTx) {
    if (tx.deleted_at) continue;
    const status = tx.status || "posted";

    if (!netByAccount[tx.account_id]) {
      netByAccount[tx.account_id] = {
        posted_income: 0,
        posted_expense: 0,
        pending_income: 0,
        pending_expense: 0,
        projected_income: 0,
        projected_expense: 0,
      };
    }
    const bucket = netByAccount[tx.account_id];
    const amt = Math.abs(tx.amount);

    if (status === "posted") {
      if (tx.transaction_date <= todayStr) {
        // Past/today posted transactions → actual balance
        if (tx.is_income) bucket.posted_income += amt;
        else bucket.posted_expense += amt;
      } else {
        // Future-dated confirmed (posted) transactions → projected balance only
        if (projectedToDate && tx.transaction_date > projectedToDate) continue;
        if (tx.is_income) bucket.projected_income += amt;
        else bucket.projected_expense += amt;
      }
    } else if (status === "pending") {
      if (tx.is_income) bucket.pending_income += amt;
      else bucket.pending_expense += amt;
    } else if (status === "projected") {
      if (projectedToDate && tx.transaction_date > projectedToDate) continue;
      if (tx.is_income) bucket.projected_income += amt;
      else bucket.projected_expense += amt;
    }
  }

  return accounts.map((acct) => {
    const sums = netByAccount[acct.id] || {
      posted_income: 0,
      posted_expense: 0,
      pending_income: 0,
      pending_expense: 0,
      projected_income: 0,
      projected_expense: 0,
    };
    const asset = isAssetAccount(acct.type);
    const postedNet = asset
      ? sums.posted_income - sums.posted_expense
      : sums.posted_expense - sums.posted_income;
    const pendingNet = asset
      ? sums.pending_income - sums.pending_expense
      : sums.pending_expense - sums.pending_income;
    const projectedNet = asset
      ? sums.projected_income - sums.projected_expense
      : sums.projected_expense - sums.projected_income;
    const balance = (acct.starting_balance || 0) + postedNet;
    // Closed accounts freeze at actual balance (no projection growth)
    const projectedBalance = acct.closed_at
      ? balance
      : balance + pendingNet + projectedNet;

    return {
      ...acct,
      transaction_net: postedNet,
      balance,
      pending_net: pendingNet,
      projected_balance: projectedBalance,
      is_asset: asset,
    };
  });
}

/**
 * Fetch net worth history — Supabase first, fall back to IndexedDB.
 * Returns [] when offline and no cached transactions exist.
 */
export async function getNetWorthHistoryOffline({ projectedToDate } = {}) {
  const result = await tryOnline(() =>
    _getNetWorthHistory({ projectedToDate }),
  );
  if (!result.offline) return result.data;

  // Offline fallback: compute from IndexedDB
  let accounts = await db.accounts.toArray();
  accounts = accounts.filter((a) => a.is_active !== false);
  if (!accounts.length) return { history: [], projectedFuture: [] };

  let allTx = await db.transactions.toArray();
  allTx = allTx.filter((t) => !t.deleted_at);

  const historyTx = allTx.filter((t) => t.status !== "projected");
  if (!historyTx.length) return { history: [], projectedFuture: [] };

  const sortedDates = historyTx.map((t) => t.transaction_date).sort();
  const earliest = sortedDates[0].slice(0, 7);
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const months = [];
  let [ey, em] = earliest.split("-").map(Number);
  const [cy, cm] = current.split("-").map(Number);
  while (ey < cy || (ey === cy && em <= cm)) {
    months.push(`${ey}-${String(em).padStart(2, "0")}`);
    em++;
    if (em > 12) {
      em = 1;
      ey++;
    }
  }

  const txByAccount = {};
  for (const tx of historyTx) {
    const ym = tx.transaction_date.slice(0, 7);
    if (!txByAccount[tx.account_id]) txByAccount[tx.account_id] = {};
    if (!txByAccount[tx.account_id][ym])
      txByAccount[tx.account_id][ym] = { income: 0, expense: 0 };
    const amt = Math.abs(tx.amount);
    if (tx.is_income) txByAccount[tx.account_id][ym].income += amt;
    else txByAccount[tx.account_id][ym].expense += amt;
  }

  const finalBalances = {};
  const accountSeries = accounts.map((acct) => {
    const asset = isAssetAccount(acct.type);
    let running = acct.starting_balance || 0;
    const byMonth = txByAccount[acct.id] || {};
    const series = months.map((ym) => {
      const { income = 0, expense = 0 } = byMonth[ym] || {};
      running += asset ? income - expense : expense - income;
      return { balance: running, is_asset: asset };
    });
    finalBalances[acct.id] = { balance: running, is_asset: asset };
    return series;
  });

  const SHORT_MONTHS = [
    "",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const history = months.map((ym, mi) => {
    let totalAssets = 0;
    let totalLiabilities = 0;
    for (const series of accountSeries) {
      const { balance, is_asset } = series[mi];
      if (is_asset) totalAssets += balance;
      else totalLiabilities += balance;
    }
    const [y, m] = ym.split("-").map(Number);
    return {
      yearMonth: ym,
      label: `${SHORT_MONTHS[m]} '${String(y).slice(2)}`,
      netWorth: totalAssets - totalLiabilities,
      totalAssets,
      totalLiabilities,
    };
  });

  // Projected future — include both recurring-projected AND future-dated confirmed (posted) transactions
  const nextMonthStart = (() => {
    const [cy2, cm2] = current.split("-").map(Number);
    const ny = cm2 === 12 ? cy2 + 1 : cy2;
    const nm = cm2 === 12 ? 1 : cm2 + 1;
    return `${ny}-${String(nm).padStart(2, "0")}`;
  })();
  const projectedTx = allTx.filter(
    (t) =>
      t.status === "projected" ||
      (t.status === "posted" &&
        t.transaction_date.slice(0, 7) >= nextMonthStart),
  );
  const cappedProjectedTx = projectedToDate
    ? projectedTx.filter((t) => t.transaction_date <= projectedToDate)
    : projectedTx;
  if (!cappedProjectedTx.length) return { history, projectedFuture: [] };

  const projByAccount = {};
  for (const tx of cappedProjectedTx) {
    const ym = tx.transaction_date.slice(0, 7);
    if (!projByAccount[tx.account_id]) projByAccount[tx.account_id] = {};
    if (!projByAccount[tx.account_id][ym])
      projByAccount[tx.account_id][ym] = { income: 0, expense: 0 };
    const amt = Math.abs(tx.amount);
    if (tx.is_income) projByAccount[tx.account_id][ym].income += amt;
    else projByAccount[tx.account_id][ym].expense += amt;
  }

  const futureDates = cappedProjectedTx.map((t) => t.transaction_date).sort();
  const latestProjected = futureDates[futureDates.length - 1].slice(0, 7);

  const futureMonths = [];
  let [fy, fm] = current.split("-").map(Number);
  const [ly, lm] = latestProjected.split("-").map(Number);
  fm++;
  if (fm > 12) {
    fm = 1;
    fy++;
  }
  while (fy < ly || (fy === ly && fm <= lm)) {
    futureMonths.push(`${fy}-${String(fm).padStart(2, "0")}`);
    fm++;
    if (fm > 12) {
      fm = 1;
      fy++;
    }
  }

  if (!futureMonths.length) return { history, projectedFuture: [] };

  const runningProjected = {};
  for (const acct of accounts) {
    runningProjected[acct.id] =
      finalBalances[acct.id]?.balance ?? (acct.starting_balance || 0);
  }

  const projectedFuture = futureMonths.map((ym) => {
    let totalAssets = 0;
    let totalLiabilities = 0;
    for (const acct of accounts) {
      const asset = isAssetAccount(acct.type);
      const { income = 0, expense = 0 } =
        (projByAccount[acct.id] || {})[ym] || {};
      runningProjected[acct.id] += asset ? income - expense : expense - income;
      if (asset) totalAssets += runningProjected[acct.id];
      else totalLiabilities += runningProjected[acct.id];
    }
    const [y, m] = ym.split("-").map(Number);
    return {
      yearMonth: ym,
      label: `${SHORT_MONTHS[m]} '${String(y).slice(2)}`,
      netWorth: totalAssets - totalLiabilities,
      totalAssets,
      totalLiabilities,
    };
  });

  return { history, projectedFuture };
}

export async function getMaxProjectedDateOffline() {
  const result = await tryOnline(() => _getMaxProjectedDate());
  if (!result.offline) return result.data;

  // Offline: scan IndexedDB for projected or future-dated posted transactions
  const todayStr = getTodayString();
  const allTx = await db.transactions.toArray();
  const dates = allTx
    .filter(
      (t) =>
        !t.deleted_at &&
        (t.status === "projected" ||
          (t.status === "posted" && t.transaction_date > todayStr)),
    )
    .map((t) => t.transaction_date)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export async function createAccountOffline(acctData) {
  const id = newId();
  const result = await tryOnline(() => _createAccount({ ...acctData, id }));
  if (!result.offline) {
    await cacheWritten("accounts", [result.data]);
    return result.data;
  }
  const now = new Date().toISOString();
  const row = {
    id,
    user_id: null,
    name: acctData.name?.trim(),
    type: acctData.type,
    starting_balance: acctData.starting_balance || 0,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  await putOffline("accounts", row, "create");
  await enqueue("accounts", id, "create");
  return row;
}

export async function updateAccountOffline(id, updates) {
  const result = await tryOnlineWrite("accounts", [id], () =>
    _updateAccount(id, updates),
  );
  if (!result.offline) {
    await cacheWritten("accounts", [result.data]);
    return result.data;
  }
  const existing = await db.accounts.get(id);
  if (!existing) throw new Error(`Account ${id} not found locally`);
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  await putOffline(
    "accounts",
    updated,
    existing._offline ? existing._action : "update",
  );
  await enqueue(
    "accounts",
    id,
    existing._offline ? existing._action : "update",
  );
  return updated;
}

export async function deleteAccountOffline(id) {
  const result = await tryOnlineWrite("accounts", [id], () => _deleteAccount(id));
  if (!result.offline) {
    await db.accounts.update(id, { is_active: false });
    notifyTable("accounts");
    return;
  }
  const existing = await db.accounts.get(id);
  if (existing) {
    await putOffline("accounts", { ...existing, is_active: false }, "delete");
    await enqueue("accounts", id, "delete");
  }
}

export async function closeAccountOffline(id, closedAt) {
  const result = await tryOnlineWrite("accounts", [id], () =>
    _closeAccount(id, closedAt),
  );
  if (!result.offline) {
    await db.accounts.update(id, { closed_at: closedAt });
    notifyTable("accounts");
    return result.data;
  }
  const existing = await db.accounts.get(id);
  if (!existing) throw new Error(`Account ${id} not found locally`);
  const updated = {
    ...existing,
    closed_at: closedAt,
    updated_at: new Date().toISOString(),
  };
  await putOffline(
    "accounts",
    updated,
    existing._offline ? existing._action : "update",
  );
  await enqueue(
    "accounts",
    id,
    existing._offline ? existing._action : "update",
  );
  return updated;
}

export async function reopenAccountOffline(id) {
  const result = await tryOnlineWrite("accounts", [id], () => _reopenAccount(id));
  if (!result.offline) {
    await db.accounts.update(id, { closed_at: null });
    notifyTable("accounts");
    return result.data;
  }
  const existing = await db.accounts.get(id);
  if (!existing) throw new Error(`Account ${id} not found locally`);
  const updated = {
    ...existing,
    closed_at: null,
    updated_at: new Date().toISOString(),
  };
  await putOffline(
    "accounts",
    updated,
    existing._offline ? existing._action : "update",
  );
  await enqueue(
    "accounts",
    id,
    existing._offline ? existing._action : "update",
  );
  return updated;
}

/**
 * Fetch per-account daily balance history — Supabase first, fall back to IndexedDB.
 */
export async function getAccountBalanceHistoryOffline(opts) {
  const result = await tryOnline(() => _getAccountBalanceHistory(opts));
  if (!result.offline) return result.data;

  // Offline fallback: compute from IndexedDB
  const { accountIds, startDate, endDate } = opts;
  if (!accountIds?.length) return [];

  let accounts = await db.accounts.toArray();
  accounts = accounts.filter(
    (a) => a.is_active !== false && accountIds.includes(a.id),
  );
  if (!accounts.length) return [];

  // Intentionally UTC so this offline fold matches the
  // get_account_balance_history RPC, which anchors on Postgres CURRENT_DATE.
  const now = new Date();
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

  let allTx = await db.transactions.toArray();
  allTx = allTx.filter(
    (t) => !t.deleted_at && accountIds.includes(t.account_id),
  );
  allTx.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

  const txByAccountDate = {};
  for (const acct of accounts) txByAccountDate[acct.id] = {};
  for (const tx of allTx) {
    if (!txByAccountDate[tx.account_id]) continue;
    const d = tx.transaction_date;
    const isPast = d <= todayStr;
    const status = tx.status || "posted";
    if (isPast && status === "projected") continue;
    if (!txByAccountDate[tx.account_id][d])
      txByAccountDate[tx.account_id][d] = [];
    txByAccountDate[tx.account_id][d].push(tx);
  }

  // Clamp start to earliest transaction date so we don't generate empty leading days
  const earliestTx = allTx.length ? allTx[0].transaction_date : startDate;
  const effectiveStart = startDate < earliestTx ? earliestTx : startDate;

  const dates = [];
  const cur = new Date(effectiveStart + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  while (cur <= end) {
    dates.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
    );
    cur.setDate(cur.getDate() + 1);
  }

  const runningBalances = {};
  for (const acct of accounts) {
    runningBalances[acct.id] = acct.starting_balance || 0;
    const asset = isAssetAccount(acct.type);
    for (const tx of allTx) {
      if (tx.account_id !== acct.id) continue;
      if (tx.transaction_date >= effectiveStart) break;
      const isPast = tx.transaction_date <= todayStr;
      const status = tx.status || "posted";
      if (isPast && status === "projected") continue;
      const amt = Math.abs(tx.amount);
      const sign = tx.is_income ? 1 : -1;
      runningBalances[acct.id] += asset ? sign * amt : -sign * amt;
    }
  }

  const series = [];
  for (const date of dates) {
    for (const acct of accounts) {
      const asset = isAssetAccount(acct.type);
      const dayTx = txByAccountDate[acct.id][date] || [];
      for (const tx of dayTx) {
        const amt = Math.abs(tx.amount);
        const sign = tx.is_income ? 1 : -1;
        runningBalances[acct.id] += asset ? sign * amt : -sign * amt;
      }
    }
    const balances = {};
    let total = 0;
    for (const acct of accounts) {
      balances[acct.id] = runningBalances[acct.id];
      total += runningBalances[acct.id];
    }
    series.push({ date, balances, total });
  }

  return series;
}

/**
 * Fetch upcoming transactions — Supabase first, fall back to IndexedDB.
 */
export async function getUpcomingTransactionsOffline(opts) {
  const result = await tryOnline(() => _getUpcomingTransactions(opts));
  if (!result.offline) return result.data;

  const { accountIds, endDate } = opts;
  if (!accountIds?.length) return [];

  const todayStr = getTodayString();

  let rows = await db.transactions.toArray();
  rows = rows.filter(
    (r) =>
      !r.deleted_at &&
      accountIds.includes(r.account_id) &&
      (r.status === "pending" || r.status === "projected") &&
      r.transaction_date >= todayStr &&
      (!endDate || r.transaction_date <= endDate),
  );

  // Attach cached category/account data
  rows = await attachJoins(rows);

  rows.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
  return rows;
}

// ══════════════════════════════════════════════════════════════════════════════
// RECURRING TEMPLATES (pause / resume)
// ══════════════════════════════════════════════════════════════════════════════

import {
  pauseRecurringTemplate as _pauseRecurringTemplate,
  resumeRecurringTemplate as _resumeRecurringTemplate,
  getTemplatesForAccount as _getTemplatesForAccount,
} from "./recurring";

export async function pauseRecurringTemplateOffline(id) {
  const result = await tryOnlineWrite("recurring_templates", [id], () =>
    _pauseRecurringTemplate(id),
  );
  if (!result.offline) {
    await db.recurring_templates.update(id, { is_paused: true });
    notifyTable("recurring_templates");
    return result.data;
  }
  const existing = await db.recurring_templates.get(id);
  if (!existing) throw new Error(`Recurring template ${id} not found locally`);
  const updated = { ...existing, is_paused: true };
  await putOffline(
    "recurring_templates",
    updated,
    existing._offline ? existing._action : "update",
  );
  await enqueue(
    "recurring_templates",
    id,
    existing._offline ? existing._action : "update",
  );
  return updated;
}

export async function resumeRecurringTemplateOffline(id) {
  const templates = await db.recurring_templates.toArray();
  const template = templates.find((row) => row.id === id);
  if (template) {
    await assertCachedCategoryAvailable(template.category_id);
    for (const child of templates.filter((row) => row.group_id === id && row.is_active !== false && !row.is_paused)) {
      await assertCachedCategoryAvailable(child.category_id);
    }
  }
  const result = await tryOnlineWrite("recurring_templates", [id], () =>
    _resumeRecurringTemplate(id),
  );
  if (!result.offline) {
    await db.recurring_templates.update(id, { is_paused: false });
    notifyTable("recurring_templates");
    return result.data;
  }
  const existing = await db.recurring_templates.get(id);
  if (!existing) throw new Error(`Recurring template ${id} not found locally`);
  const updated = { ...existing, is_paused: false };
  await putOffline(
    "recurring_templates",
    updated,
    existing._offline ? existing._action : "update",
  );
  await enqueue(
    "recurring_templates",
    id,
    existing._offline ? existing._action : "update",
  );
  return updated;
}

export async function getTemplatesForAccountOffline(accountId) {
  const result = await tryOnline(() => _getTemplatesForAccount(accountId));
  if (!result.offline) return result.data;

  // Offline fallback — scan local recurring_templates
  const allTemplates = await db.recurring_templates.toArray();
  return allTemplates.filter(
    (t) =>
      t.is_active !== false &&
      (t.account_id === accountId || t.to_account_id === accountId),
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ══════════════════════════════════════════════════════════════════════════════

import {
  getCategories as _getCategories,
  createCategory as _createCategory,
  updateCategory as _updateCategory,
  deleteCategory as _deleteCategory,
  setCategoryArchived as _setCategoryArchived,
  getUserPreference as _getUserPreference,
  setUserPreference as _setUserPreference,
} from "./categories";

export async function getCategoriesOffline() {
  return swrRead({
    key: "categories:all",
    table: "categories",
    readCache: () => readCategoriesFromCache(),
    fetchFresh: () => _getCategories(),
    writeCache: (rows) => cacheCategoriesHelper(rows),
  });
}

async function readCategoriesFromCache() {
  let rows = await db.categories.toArray();
  rows = rows.filter((r) => r.is_active !== false);
  rows.sort(
    (a, b) =>
      (a.type || "").localeCompare(b.type || "") ||
      (a.sort_order || 0) - (b.sort_order || 0) ||
      (a.name || "").localeCompare(b.name || ""),
  );
  return rows;
}

async function cacheCategoriesHelper(data) {
  const pending = await db.categories.where("_offline").equals(1).primaryKeys();
  const pendingSet = new Set(pending);
  const toCache = data.filter((r) => !pendingSet.has(r.id));
  if (toCache.length) await db.categories.bulkPut(toCache);
}

export async function createCategoryOffline(catData) {
  const id = newId();
  const result = await tryOnline(() => _createCategory({ ...catData, id }));
  if (!result.offline) {
    await cacheWritten("categories", [result.data]);
    return result.data;
  }
  const now = new Date().toISOString();
  const row = {
    id,
    user_id: null,
    name: catData.name?.trim(),
    type: catData.type,
    color: catData.color,
    is_active: true,
    is_archived: false,
    sort_order: 0,
    created_at: now,
  };
  await putOffline("categories", row, "create");
  await enqueue("categories", id, "create");
  return row;
}

export async function updateCategoryOffline(id, updates) {
  const result = await tryOnlineWrite("categories", [id], () =>
    _updateCategory(id, updates),
  );
  if (!result.offline) {
    await cacheWritten("categories", [result.data]);
    return result.data;
  }
  const existing = await db.categories.get(id);
  if (!existing) throw new Error(`Category ${id} not found locally`);
  const updated = { ...existing };
  if (updates.name !== undefined) updated.name = updates.name.trim();
  if (updates.color !== undefined) updated.color = updates.color;
  if (updates.type !== undefined) updated.type = updates.type;
  await putOffline(
    "categories",
    updated,
    existing._offline ? existing._action : "update",
  );
  await enqueue(
    "categories",
    id,
    existing._offline ? existing._action : "update",
  );
  return updated;
}

export async function deleteCategoryOffline(id) {
  const result = await tryOnlineWrite("categories", [id], () => _deleteCategory(id));
  if (!result.offline) {
    await db.categories.update(id, { is_active: false });
    notifyTable("categories");
    return;
  }
  const existing = await db.categories.get(id);
  if (existing) {
    await putOffline("categories", { ...existing, is_active: false }, "delete");
    await enqueue("categories", id, "delete");
  }
}

export async function archiveCategoryOffline(id) {
  if (!isOnline()) throw new Error("Connect to the internet to archive a category.");
  const existing = await db.categories.get(id);
  if (existing?._offline) {
    throw new Error("Sync this category's pending changes before archiving it.");
  }
  const row = await _setCategoryArchived(id, true);
  await cacheWritten("categories", [row]);
  return row;
}

export async function restoreCategoryOffline(id) {
  const existing = await db.categories.get(id);
  if (existing?.is_active === false || existing?._action === "delete") {
    throw new Error("Category not found or deleted.");
  }
  if (!existing?._offline) {
    const result = await tryOnline(() => _setCategoryArchived(id, false));
    if (!result.offline) {
      await cacheWritten("categories", [result.data]);
      return result.data;
    }
  }
  if (!existing) throw new Error("Category not found locally.");
  const row = { ...existing, is_archived: false, _archiveRestore: true };
  const action = existing._offline ? existing._action : "update";
  await putOffline("categories", row, action);
  await enqueue("categories", id, action);
  return row;
}

// ══════════════════════════════════════════════════════════════════════════════
// USER PREFERENCES
// ══════════════════════════════════════════════════════════════════════════════

export async function getUserPreferenceOffline(key) {
  return swrRead({
    key: `user_preferences:${key}`,
    table: "user_preferences",
    // user_preferences entries can legitimately be falsy (null, false, 0).
    // Treat "row not present in cache" as the empty signal instead, so a
    // value of `false` doesn't trigger a synchronous network round-trip.
    isEmpty: (v) => v === undefined,
    readCache: async () => {
      const row = await db.user_preferences
        .where("preference_key")
        .equals(key)
        .first();
      return row ? (row.preference_value ?? null) : undefined;
    },
    fetchFresh: () => _getUserPreference(key),
    writeCache: async (value) => {
      const existing = await db.user_preferences
        .where("preference_key")
        .equals(key)
        .first();
      if (existing?._offline === 1) {
        // A local change is still queued; the server value is older.
      } else if (existing) {
        await db.user_preferences.update(existing.id, {
          preference_value: value,
          updated_at: new Date().toISOString(),
        });
      } else if (value != null) {
        // The service returns only the value, so this is a placeholder row
        // (local id, no user_id). Sync matches preferences on their natural
        // key and the next pull replaces the placeholder with the server row.
        await db.user_preferences.put({
          id: newId(),
          user_id: null,
          preference_key: key,
          preference_value: value,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    },
  });
}

export async function setUserPreferenceOffline(key, value) {
  const cached = await db.user_preferences
    .where("preference_key")
    .equals(key)
    .first();
  const result = await tryOnlineWrite("user_preferences", [cached?.id], () =>
    _setUserPreference(key, value),
  );
  if (!result.offline) {
    // Also cache
    const existing = await db.user_preferences
      .where("preference_key")
      .equals(key)
      .first();
    if (existing) {
      await db.user_preferences.update(existing.id, {
        preference_value: value,
        updated_at: new Date().toISOString(),
      });
    } else {
      await db.user_preferences.put({
        id: newId(),
        user_id: null,
        preference_key: key,
        preference_value: value,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    notifyTable("user_preferences");
    return;
  }
  // Offline
  const existing = await db.user_preferences
    .where("preference_key")
    .equals(key)
    .first();
  const now = new Date().toISOString();
  if (existing) {
    await putOffline(
      "user_preferences",
      { ...existing, preference_value: value, updated_at: now },
      existing._offline ? existing._action : "update",
    );
    await enqueue(
      "user_preferences",
      existing.id,
      existing._offline ? existing._action : "update",
    );
  } else {
    const id = newId();
    await putOffline(
      "user_preferences",
      {
        id,
        user_id: null,
        preference_key: key,
        preference_value: value,
        created_at: now,
        updated_at: now,
      },
      "create",
    );
    await enqueue("user_preferences", id, "create");
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BUDGET PLANS & ITEMS
// ══════════════════════════════════════════════════════════════════════════════

import {
  getBudgetPlan as _getBudgetPlan,
  createBudgetPlan as _createBudgetPlan,
  updateBudgetPlan as _updateBudgetPlan,
  getBudgetItems as _getBudgetItems,
  upsertBudgetItem as _upsertBudgetItem,
} from "./budgets";

export async function getBudgetPlanOffline(month, year) {
  return swrRead({
    key: `budget_plans:${year}-${month}`,
    table: "budget_plans",
    readCache: async () => {
      const row = await db.budget_plans.where({ month, year }).first();
      return row ?? null;
    },
    fetchFresh: () => _getBudgetPlan(month, year),
    writeCache: async (plan) => {
      if (plan) await cacheServerRows("budget_plans", [plan]);
    },
  });
}

export async function createBudgetPlanOffline(planData) {
  const id = newId();
  const result = await tryOnline(() => _createBudgetPlan({ ...planData, id }));
  if (!result.offline) {
    await cacheWritten("budget_plans", [result.data]);
    return result.data;
  }
  const now = new Date().toISOString();
  const row = {
    id,
    user_id: null,
    month: planData.month,
    year: planData.year,
    total_income: planData.total_income,
    created_at: now,
    updated_at: now,
  };
  await putOffline("budget_plans", row, "create");
  await enqueue("budget_plans", id, "create");
  return row;
}

export async function updateBudgetPlanOffline(planId, updates) {
  const result = await tryOnlineWrite("budget_plans", [planId], () =>
    _updateBudgetPlan(planId, updates),
  );
  if (!result.offline) {
    await cacheWritten("budget_plans", [result.data]);
    return result.data;
  }
  const existing = await db.budget_plans.get(planId);
  if (!existing) throw new Error(`Budget plan ${planId} not found locally`);
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  await putOffline(
    "budget_plans",
    updated,
    existing._offline ? existing._action : "update",
  );
  await enqueue(
    "budget_plans",
    planId,
    existing._offline ? existing._action : "update",
  );
  return updated;
}

export async function getBudgetItemsOffline(budgetPlanId) {
  return swrRead({
    key: `budget_items:${budgetPlanId}`,
    table: "budget_items",
    readCache: async () => {
      const items = await db.budget_items
        .where("budget_plan_id")
        .equals(budgetPlanId)
        .toArray();
      // Re-attach the cached category join so consumers see the same shape
      // they get from Supabase (`item.categories.name`, `.color`, `.type`).
      return attachJoins(items, { accounts: false });
    },
    fetchFresh: () => _getBudgetItems(budgetPlanId),
    writeCache: async (items) => {
      // Don't trample offline-pending items (e.g. user edited a row offline).
      await cacheServerRows("budget_items", items);
    },
  });
}

export async function upsertBudgetItemOffline(itemData) {
  const cached = await db.budget_items
    .where("[budget_plan_id+category_id]")
    .equals([itemData.budget_plan_id, itemData.category_id])
    .first();
  const result = await tryOnlineWrite(
    "budget_items",
    [cached?.id],
    () => _upsertBudgetItem(itemData),
    {
      budget_plans: [itemData.budget_plan_id],
      categories: [itemData.category_id],
    },
  );
  if (!result.offline) {
    await cacheWritten("budget_items", [result.data]);
    return result.data;
  }
  // Check if an item with this budget_plan_id+category_id already exists locally
  const existing = await db.budget_items
    .where("[budget_plan_id+category_id]")
    .equals([itemData.budget_plan_id, itemData.category_id])
    .first();

  if (existing) {
    const updated = { ...existing, planned_amount: itemData.planned_amount };
    await putOffline(
      "budget_items",
      updated,
      existing._offline ? existing._action : "update",
    );
    await enqueue(
      "budget_items",
      existing.id,
      existing._offline ? existing._action : "update",
    );
    return updated;
  }
  const id = newId();
  const row = { id, ...itemData };
  await putOffline("budget_items", row, "create");
  await enqueue("budget_items", id, "create");
  return row;
}

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 3 — server-side aggregations w/ Dexie offline fallbacks
// ══════════════════════════════════════════════════════════════════════════════
//
// Each of these wraps a Postgres RPC (added in
// sql_scripts/supabase_phase3_aggregations.sql).  The online path is a single
// round-trip; the offline fallback runs the same accounting rules over the
// rows we already cache in IndexedDB so report screens keep working without a
// network connection.

import {
  isTrueIncome as _isTrueIncome,
  isSpendingCredit as _isSpendingCredit,
  isIncomeDebit as _isIncomeDebit,
  isSettledTransaction as _isSettledTransaction,
  toDateString,
  getTodayString,
} from "../utils/helpers";

import {
  getPlanVsActual as _getPlanVsActual,
  getPlanVsActualYTD as _getPlanVsActualYTD,
} from "./budgets";

import {
  getMonthlySpendingTrend as _getMonthlySpendingTrend,
  getYearlySpendingTrend as _getYearlySpendingTrend,
} from "./analytics";

import { getTransactionYears as _getTransactionYears } from "./transactions";

const SHORT_MONTHS = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const CATEGORY_TYPE_ORDER = { income: 0, needs: 1, wants: 2, savings: 3 };

function sortPlanVsActualCategories(a, b) {
  const ta = CATEGORY_TYPE_ORDER[a.categoryType] ?? 4;
  const tb = CATEGORY_TYPE_ORDER[b.categoryType] ?? 4;
  if (ta !== tb) return ta - tb;
  return (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
}

/**
 * Compute plan-vs-actual from Dexie tables.  Mirrors the JS version that
 * `services/budgets.js` used pre-Phase-3, but reads from IndexedDB instead
 * of paginating Supabase.  Used as the offline fallback.
 */
async function computePlanVsActualFromCache({
  month,
  year,
  ytd = false,
  asOf = null,
}) {
  const startDate = `${year}-01-01`;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
  const lowerBound = ytd ? startDate : monthStart;

  const allCats = await db.categories.toArray();
  const catById = Object.fromEntries(allCats.map((c) => [c.id, c]));

  // Plans
  const allPlans = await db.budget_plans.toArray();
  const relevantPlans = allPlans.filter((p) => {
    if (p.year !== year) return false;
    if (ytd) return p.month >= 1 && p.month <= month;
    return p.month === month;
  });
  const plannedIncome = relevantPlans.reduce(
    (sum, p) => sum + (p.total_income || 0),
    0,
  );
  const planIds = new Set(relevantPlans.map((p) => p.id));

  // Items
  const allItems = await db.budget_items.toArray();
  const items = allItems.filter((it) => planIds.has(it.budget_plan_id));

  // Transactions in window
  const allTx = await db.transactions.toArray();
  const txs = allTx.filter(
    (t) =>
      !t.deleted_at &&
      t.transaction_date >= lowerBound &&
      t.transaction_date < endDate &&
      _isSettledTransaction(t, asOf),
  );

  const map = {};
  const upsertCategory = (catId, cat) => {
    if (!map[catId]) {
      map[catId] = {
        categoryId: catId,
        categoryName: cat?.name || "Unknown",
        categoryColor: cat?.color || "#A8A29E",
        categoryType: cat?.type || "expense",
        sortOrder: cat?.sort_order ?? 999,
        planned: 0,
        actual: 0,
      };
    }
    return map[catId];
  };

  for (const item of items) {
    const cat = catById[item.category_id];
    if (cat?.type === "transfer") continue;
    upsertCategory(item.category_id, cat).planned += item.planned_amount || 0;
  }

  for (const tx of txs) {
    const cat = catById[tx.category_id] || tx.categories;
    if (cat?.type === "transfer") continue;
    const catId = tx.category_id || "uncategorized";
    const entry = upsertCategory(catId, cat);
    const txWithCat = { ...tx, categories: cat };
    if (_isTrueIncome(txWithCat)) {
      entry.actual += Math.abs(tx.amount);
    } else if (_isIncomeDebit(txWithCat)) {
      entry.actual -= Math.abs(tx.amount);
    } else if (_isSpendingCredit(txWithCat)) {
      entry.actual -= Math.abs(tx.amount);
    } else {
      entry.actual += Math.abs(tx.amount);
    }
  }

  const categories = Object.values(map).sort(sortPlanVsActualCategories);
  const actualIncome = categories
    .filter((c) => c.categoryType === "income")
    .reduce((sum, c) => sum + c.actual, 0);

  return { categories, plannedIncome, actualIncome };
}

/**
 * Plan-vs-Actual for a single month — SWR over the `get_plan_vs_actual` RPC.
 *
 * Returns the previously-cached aggregate from Dexie immediately so the
 * report renders instantly on cold reloads, then fetches a fresh aggregate
 * in the background.  When the fresh result arrives we notify the
 * `budget_items` table so the React Query bridge refetches subscribed hooks.
 */
export async function getPlanVsActualOffline({ month, year, asOf = null }) {
  const cacheKey = `pva:m:${year}-${month}${asOf ? `:asof:${asOf}` : ""}`;
  return rpcRead({
    key: cacheKey,
    // RPC-derived; no notifyTable to avoid the bridge → invalidate → refetch
    // → bg-revalidate → notifyTable loop.
    fetchFresh: async () => {
      const result = await tryOnline(() =>
        _getPlanVsActual({ month, year, asOf }),
      );
      if (!result.offline) return fromServer(result.data);
      return computePlanVsActualFromCache({ month, year, ytd: false, asOf });
    },
    isEmpty: (v) => v == null,
  });
}

/**
 * Plan-vs-Actual YTD — SWR over the `get_plan_vs_actual_ytd` RPC.
 */
export async function getPlanVsActualYTDOffline({
  year,
  throughMonth,
  asOf = null,
}) {
  const cacheKey = `pva:ytd:${year}-${throughMonth}${asOf ? `:asof:${asOf}` : ""}`;
  return rpcRead({
    key: cacheKey,
    fetchFresh: async () => {
      const result = await tryOnline(() =>
        _getPlanVsActualYTD({ year, throughMonth, asOf }),
      );
      if (!result.offline) return fromServer(result.data);
      return computePlanVsActualFromCache({
        month: throughMonth,
        year,
        ytd: true,
        asOf,
      });
    },
    isEmpty: (v) => v == null,
  });
}

// ── Spending trends ────────────────────────────────────────────────────────

function aggregateTrendFromCacheRows(
  rows,
  { months, endMonth, endYear, asOf = null },
) {
  const anchorEnd =
    endMonth != null && endYear != null
      ? new Date(endYear, endMonth, 0)
      : new Date();
  const startDate = new Date(
    anchorEnd.getFullYear(),
    anchorEnd.getMonth() - months + 1,
    1,
  );
  const startStr = toDateString(startDate);
  const endStr = toDateString(anchorEnd);

  const map = {};
  for (const t of rows) {
    if (t.deleted_at) continue;
    if (t.transaction_date < startStr || t.transaction_date > endStr) continue;
    if (!_isSettledTransaction(t, asOf)) continue;
    const cat = t.categories;
    if (cat?.type === "transfer") continue;

    const d = new Date(t.transaction_date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!map[key]) {
      map[key] = { key, year: y, month: m, spent: 0, income: 0, count: 0 };
    }
    if (_isTrueIncome(t)) {
      map[key].income += Math.abs(t.amount);
    } else if (_isIncomeDebit(t)) {
      map[key].income -= Math.abs(t.amount);
    } else if (_isSpendingCredit(t)) {
      map[key].spent -= Math.abs(t.amount);
      map[key].count += 1;
    } else {
      map[key].spent += Math.abs(t.amount);
      map[key].count += 1;
    }
  }
  return Object.values(map)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => ({ ...m, label: `${SHORT_MONTHS[m.month]} ${m.year}` }));
}

async function loadCacheTransactionsWithCategoryJoin() {
  return attachJoins(await db.transactions.toArray(), { accounts: false });
}

export async function getMonthlySpendingTrendOffline(opts = {}) {
  const m = opts.months ?? 6;
  const em = opts.endMonth ?? "";
  const ey = opts.endYear ?? "";
  const cacheKey = `trend:m:${m}:${ey}-${em}${opts.asOf ? `:asof:${opts.asOf}` : ""}`;
  return rpcRead({
    key: cacheKey,
    fetchFresh: async () => {
      const result = await tryOnline(() => _getMonthlySpendingTrend(opts));
      if (!result.offline) return fromServer(result.data);
      const rows = await loadCacheTransactionsWithCategoryJoin();
      return aggregateTrendFromCacheRows(rows, {
        months: opts.months ?? 6,
        endMonth: opts.endMonth,
        endYear: opts.endYear,
        asOf: opts.asOf ?? null,
      });
    },
    isEmpty: (v) => v == null,
  });
}

export async function getYearlySpendingTrendOffline(opts = {}) {
  const yrs = opts.years ?? 2;
  const em = opts.endMonth ?? "";
  const ey = opts.endYear ?? "";
  const cacheKey = `trend:y:${yrs}:${ey}-${em}${opts.asOf ? `:asof:${opts.asOf}` : ""}`;
  return rpcRead({
    key: cacheKey,
    fetchFresh: async () => {
      const result = await tryOnline(() => _getYearlySpendingTrend(opts));
      if (!result.offline) return fromServer(result.data);

      // Fold from cached transactions with the same accounting rules.
      const rows = await loadCacheTransactionsWithCategoryJoin();
      const years = opts.years ?? 2;
      const anchorEnd =
        opts.endMonth != null && opts.endYear != null
          ? new Date(opts.endYear, opts.endMonth, 0)
          : new Date();
      const startYear = anchorEnd.getFullYear() - years + 1;
      const startStr = `${startYear}-01-01`;
      const endStr = toDateString(anchorEnd);

      const map = {};
      for (const t of rows) {
        if (t.deleted_at) continue;
        if (t.transaction_date < startStr || t.transaction_date > endStr)
          continue;
        if (!_isSettledTransaction(t, opts.asOf ?? null)) continue;
        const cat = t.categories;
        if (cat?.type === "transfer") continue;
        const y = new Date(t.transaction_date).getUTCFullYear();
        if (!map[y]) map[y] = { year: y, spent: 0, income: 0, count: 0 };
        if (_isTrueIncome(t)) {
          map[y].income += Math.abs(t.amount);
        } else if (_isIncomeDebit(t)) {
          map[y].income -= Math.abs(t.amount);
        } else if (_isSpendingCredit(t)) {
          map[y].spent -= Math.abs(t.amount);
          map[y].count += 1;
        } else {
          map[y].spent += Math.abs(t.amount);
          map[y].count += 1;
        }
      }
      return Object.values(map).sort((a, b) => a.year - b.year);
    },
    isEmpty: (v) => v == null,
  });
}

// ── Transaction years ──────────────────────────────────────────────────────

/**
 * `[earliestYear .. currentYear+1]` — SWR over the `get_transaction_years` RPC.
 */
export async function getTransactionYearsOffline() {
  const cacheKey = "tx:years";
  return rpcRead({
    key: cacheKey,
    fetchFresh: async () => {
      const result = await tryOnline(() => _getTransactionYears());
      if (!result.offline) return fromServer(result.data);

      const allTx = await db.transactions.toArray();
      const dates = allTx
        .filter((t) => !t.deleted_at && t.transaction_date)
        .map((t) => t.transaction_date)
        .sort();
      const currentYear = new Date().getFullYear();
      const minYear = dates.length
        ? new Date(dates[0]).getFullYear()
        : currentYear;
      const maxYear = currentYear + 1;
      return Array.from(
        { length: maxYear - minYear + 1 },
        (_, i) => minYear + i,
      );
    },
    isEmpty: (v) => v == null,
  });
}
