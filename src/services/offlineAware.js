/**
 * Offline-aware service wrappers.
 *
 * Each wrapper follows the same pattern:
 * - **Online**: call Supabase (existing service), then cache result in IndexedDB.
 * - **Offline**: write to IndexedDB with `_offline` flags, enqueue for sync.
 * - **Read (any state)**: try Supabase first; if offline / error, fall back to IndexedDB.
 *
 * This keeps the original service modules untouched — all offline logic lives here.
 */
import db, { putOffline, readRpcCache, writeRpcCache } from "./offlineDb";
import { enqueue } from "../utils/syncQueue";
import { swrRead, notifyTable } from "./cache";

// ── SWR helpers ──
//
// Phase 1 cache-first reads: priority "hot" read functions delegate to
// `swrRead` which serves Dexie immediately and revalidates from Supabase
// in the background. Helpers in this file build the (readCache, fetchFresh,
// writeCache) triple for each function while preserving the original
// signatures and return shapes so callers don't need to change.

// ── Helpers ──

export function isOnline() {
  return navigator.onLine;
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
    // Detect network errors (fetch failures, timeout, etc.)
    if (
      !navigator.onLine ||
      err?.message?.includes("Failed to fetch") ||
      err?.message?.includes("NetworkError") ||
      err?.message?.includes("network") ||
      err?.code === "PGRST301" // JWT expired — treat as offline-ish
    ) {
      return { offline: true, error: err };
    }
    throw err; // Real Supabase error — let caller handle
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════════════════════════════

import {
  getTransactions as _getTransactions,
  createTransaction as _createTransaction,
  updateTransaction as _updateTransaction,
  deleteTransaction as _deleteTransaction,
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
    writeCache: (rows) => cacheTransactions(rows),
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
  const cats = Object.fromEntries(
    (await db.categories.toArray()).map((c) => [
      c.id,
      { id: c.id, name: c.name, color: c.color, type: c.type },
    ]),
  );
  const accts = Object.fromEntries(
    (await db.accounts.toArray()).map((a) => [
      a.id,
      { id: a.id, name: a.name, type: a.type },
    ]),
  );
  rows = rows.map((r) => ({
    ...r,
    categories: r.categories || cats[r.category_id] || null,
    accounts: r.accounts || accts[r.account_id] || null,
  }));

  // Sort newest first
  rows.sort((a, b) =>
    (b.transaction_date || "").localeCompare(a.transaction_date || ""),
  );
  return rows;
}

async function cacheTransactions(data) {
  // Don't wipe the whole table — only upsert fetched rows to preserve offline-pending ones
  const pending = await db.transactions
    .where("_offline")
    .equals(1)
    .primaryKeys();
  const pendingSet = new Set(pending);
  const toCache = data.filter((r) => !pendingSet.has(r.id));
  if (toCache.length) await db.transactions.bulkPut(toCache);
}

/**
 * Create a transaction — dual-write when online, IndexedDB-only when offline.
 */
export async function createTransactionOffline(txData) {
  const result = await tryOnline(() => _createTransaction(txData));

  if (!result.offline) {
    // Also store in IndexedDB (no offline flags)
    await db.transactions.put(result.data);
    notifyTable("transactions");
    return result.data;
  }

  // Offline: generate a temporary UUID and store locally
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    user_id: null, // Will be filled on sync
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
    deleted_at: null,
    created_at: now,
    updated_at: now,
    // Attach joined data from local cache for display
    categories: null,
    accounts: null,
  };

  // Try to resolve category/account from local cache for display
  if (txData.category_id) {
    const cat = await db.categories.get(txData.category_id);
    if (cat)
      row.categories = {
        id: cat.id,
        name: cat.name,
        color: cat.color,
        type: cat.type,
      };
  }
  if (txData.account_id) {
    const acct = await db.accounts.get(txData.account_id);
    if (acct) row.accounts = { id: acct.id, name: acct.name, type: acct.type };
  }

  await putOffline("transactions", row, "create");
  await enqueue("transactions", id, "create");
  return row;
}

/**
 * Update a transaction — dual-write when online, IndexedDB-only when offline.
 */
export async function updateTransactionOffline(id, updates) {
  const result = await tryOnline(() => _updateTransaction(id, updates));

  if (!result.offline) {
    await db.transactions.put(result.data);
    notifyTable("transactions");
    return result.data;
  }

  // Offline: update locally
  const existing = await db.transactions.get(id);
  if (!existing) throw new Error(`Transaction ${id} not found locally`);

  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };
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
 * Delete (soft-delete) a transaction.
 */
export async function deleteTransactionOffline(id) {
  const result = await tryOnline(() => _deleteTransaction(id));

  if (!result.offline) {
    // Mark deleted locally too
    await db.transactions.update(id, { deleted_at: new Date().toISOString() });
    notifyTable("transactions");
    return result.data;
  }

  // Offline soft-delete
  const existing = await db.transactions.get(id);
  if (existing) {
    const now = new Date().toISOString();
    await putOffline(
      "transactions",
      { ...existing, deleted_at: now },
      "delete",
    );
    await enqueue("transactions", id, "delete");
  }
  return [id];
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
    writeCache: (rows) => cacheTransactions(rows),
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

  const cats = Object.fromEntries(
    (await db.categories.toArray()).map((c) => [
      c.id,
      { id: c.id, name: c.name, color: c.color, type: c.type },
    ]),
  );
  const accts = Object.fromEntries(
    (await db.accounts.toArray()).map((a) => [
      a.id,
      { id: a.id, name: a.name, type: a.type },
    ]),
  );
  rows = rows.map((r) => ({
    ...r,
    categories: r.categories || cats[r.category_id] || null,
    accounts: r.accounts || accts[r.account_id] || null,
  }));

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
    writeCache: (rows) => cacheTransactions(rows),
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

  const cats = Object.fromEntries(
    (await db.categories.toArray()).map((c) => [
      c.id,
      { id: c.id, name: c.name, color: c.color, type: c.type },
    ]),
  );
  const accts = Object.fromEntries(
    (await db.accounts.toArray()).map((a) => [
      a.id,
      { id: a.id, name: a.name, type: a.type },
    ]),
  );
  rows = rows.map((r) => ({
    ...r,
    categories: r.categories || cats[r.category_id] || null,
    accounts: r.accounts || accts[r.account_id] || null,
  }));

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
 * `projected_balance`, `transaction_net`, `is_asset`. The fresh fetch's
 * cache write only persists raw account rows (computed fields are stripped)
 * because balances are derived on each render from cached transactions.
 */
export async function getAccountBalancesOffline({ projectedToDate } = {}) {
  return swrRead({
    key: `account_balances:${projectedToDate ?? "all"}`,
    // No `table` — this is RPC-derived data.  Calling notifyTable here would
    // invalidate the very query that triggered this read (via queryBridge),
    // producing an infinite refetch loop.  Sync.js calls notifyTable on
    // actual table pulls, which already cascades into invalidating this query.
    readCache: () => computeAccountBalancesFromCache({ projectedToDate }),
    fetchFresh: () => _getAccountBalances({ projectedToDate }),
    writeCache: (rows) => {
      const COMPUTED = [
        "transaction_net",
        "balance",
        "pending_net",
        "projected_balance",
        "is_asset",
      ];
      return cacheAccountsHelper(
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

  // Today's date string for filtering actual vs projected
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

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
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
  const result = await tryOnline(() => _createAccount(acctData));
  if (!result.offline) {
    await db.accounts.put(result.data);
    notifyTable("accounts");
    return result.data;
  }
  const id = crypto.randomUUID();
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
  const result = await tryOnline(() => _updateAccount(id, updates));
  if (!result.offline) {
    await db.accounts.put(result.data);
    notifyTable("accounts");
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
  const result = await tryOnline(() => _deleteAccount(id));
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
  const result = await tryOnline(() => _closeAccount(id, closedAt));
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
  const result = await tryOnline(() => _reopenAccount(id));
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

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

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

  const { accountIds } = opts;
  if (!accountIds?.length) return [];

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  let rows = await db.transactions.toArray();
  rows = rows.filter(
    (r) =>
      !r.deleted_at &&
      accountIds.includes(r.account_id) &&
      (r.status === "pending" || r.status === "projected") &&
      r.transaction_date >= todayStr,
  );

  // Attach cached category/account data
  const cats = Object.fromEntries(
    (await db.categories.toArray()).map((c) => [
      c.id,
      { id: c.id, name: c.name, color: c.color, type: c.type },
    ]),
  );
  const accts = Object.fromEntries(
    (await db.accounts.toArray()).map((a) => [
      a.id,
      { id: a.id, name: a.name, type: a.type },
    ]),
  );
  rows = rows.map((r) => ({
    ...r,
    categories: r.categories || cats[r.category_id] || null,
    accounts: r.accounts || accts[r.account_id] || null,
  }));

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
  const result = await tryOnline(() => _pauseRecurringTemplate(id));
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
  const result = await tryOnline(() => _resumeRecurringTemplate(id));
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
  const result = await tryOnline(() => _createCategory(catData));
  if (!result.offline) {
    await db.categories.put(result.data);
    notifyTable("categories");
    return result.data;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    user_id: null,
    name: catData.name?.trim(),
    type: catData.type,
    color: catData.color,
    is_active: true,
    sort_order: 0,
    created_at: now,
  };
  await putOffline("categories", row, "create");
  await enqueue("categories", id, "create");
  return row;
}

export async function updateCategoryOffline(id, updates) {
  const result = await tryOnline(() => _updateCategory(id, updates));
  if (!result.offline) {
    await db.categories.put(result.data);
    notifyTable("categories");
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
  const result = await tryOnline(() => _deleteCategory(id));
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
      if (existing) {
        await db.user_preferences.update(existing.id, {
          preference_value: value,
          updated_at: new Date().toISOString(),
        });
      } else if (value != null) {
        await db.user_preferences.put({
          id: crypto.randomUUID(),
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
  const result = await tryOnline(() => _setUserPreference(key, value));
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
        id: crypto.randomUUID(),
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
    const id = crypto.randomUUID();
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
    // A user can legitimately have no plan for a given month — `null` is a
    // valid cached answer. Treat only `undefined` as "cache miss".
    isEmpty: (v) => v === undefined,
    readCache: async () => {
      const row = await db.budget_plans.where({ month, year }).first();
      // Disambiguate "never fetched" from "fetched, none exists".
      // We can't easily tell those apart from Dexie alone, so use the
      // table's row count as a proxy: if there are no plans cached at all,
      // treat it as cold so we await the network the first time.
      if (row) return row;
      const anyPlans = await db.budget_plans.count();
      return anyPlans > 0 ? null : undefined;
    },
    fetchFresh: () => _getBudgetPlan(month, year),
    writeCache: async (plan) => {
      if (plan) await db.budget_plans.put(plan);
    },
  });
}

export async function createBudgetPlanOffline(planData) {
  const result = await tryOnline(() => _createBudgetPlan(planData));
  if (!result.offline) {
    await db.budget_plans.put(result.data);
    notifyTable("budget_plans");
    return result.data;
  }
  const id = crypto.randomUUID();
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
  const result = await tryOnline(() => _updateBudgetPlan(planId, updates));
  if (!result.offline) {
    await db.budget_plans.put(result.data);
    notifyTable("budget_plans");
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
      const cats = Object.fromEntries(
        (await db.categories.toArray()).map((c) => [
          c.id,
          { id: c.id, name: c.name, color: c.color, type: c.type },
        ]),
      );
      return items.map((item) => ({
        ...item,
        categories: item.categories || cats[item.category_id] || null,
      }));
    },
    fetchFresh: () => _getBudgetItems(budgetPlanId),
    writeCache: async (items) => {
      // Don't trample offline-pending items (e.g. user edited a row offline).
      const pending = await db.budget_items
        .where("_offline")
        .equals(1)
        .primaryKeys();
      const pendingSet = new Set(pending);
      const toCache = items.filter((r) => !pendingSet.has(r.id));
      if (toCache.length) await db.budget_items.bulkPut(toCache);
    },
  });
}

export async function upsertBudgetItemOffline(itemData) {
  const result = await tryOnline(() => _upsertBudgetItem(itemData));
  if (!result.offline) {
    await db.budget_items.put(result.data);
    notifyTable("budget_items");
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
  const id = crypto.randomUUID();
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
async function computePlanVsActualFromCache({ month, year, ytd = false }) {
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
      t.transaction_date < endDate,
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
export async function getPlanVsActualOffline({ month, year }) {
  const cacheKey = `pva:m:${year}-${month}`;
  return swrRead({
    key: cacheKey,
    // RPC-derived; no notifyTable to avoid the bridge → invalidate → refetch
    // → bg-revalidate → notifyTable loop.
    readCache: () => readRpcCache(cacheKey),
    fetchFresh: async () => {
      const result = await tryOnline(() => _getPlanVsActual({ month, year }));
      if (!result.offline) return result.data;
      return computePlanVsActualFromCache({ month, year, ytd: false });
    },
    writeCache: (value) => writeRpcCache(cacheKey, value),
    isEmpty: (v) => v == null,
  });
}

/**
 * Plan-vs-Actual YTD — SWR over the `get_plan_vs_actual_ytd` RPC.
 */
export async function getPlanVsActualYTDOffline({ year, throughMonth }) {
  const cacheKey = `pva:ytd:${year}-${throughMonth}`;
  return swrRead({
    key: cacheKey,
    readCache: () => readRpcCache(cacheKey),
    fetchFresh: async () => {
      const result = await tryOnline(() =>
        _getPlanVsActualYTD({ year, throughMonth }),
      );
      if (!result.offline) return result.data;
      return computePlanVsActualFromCache({
        month: throughMonth,
        year,
        ytd: true,
      });
    },
    writeCache: (value) => writeRpcCache(cacheKey, value),
    isEmpty: (v) => v == null,
  });
}

// ── Spending trends ────────────────────────────────────────────────────────

function aggregateTrendFromCacheRows(rows, { months, endMonth, endYear }) {
  const anchorEnd =
    endMonth != null && endYear != null
      ? new Date(endYear, endMonth, 0)
      : new Date();
  const startDate = new Date(
    anchorEnd.getFullYear(),
    anchorEnd.getMonth() - months + 1,
    1,
  );
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = anchorEnd.toISOString().slice(0, 10);

  const map = {};
  for (const t of rows) {
    if (t.deleted_at) continue;
    if (t.transaction_date < startStr || t.transaction_date > endStr) continue;
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
  const allTx = await db.transactions.toArray();
  const cats = Object.fromEntries(
    (await db.categories.toArray()).map((c) => [
      c.id,
      { id: c.id, name: c.name, color: c.color, type: c.type },
    ]),
  );
  return allTx.map((t) => ({
    ...t,
    categories: t.categories || cats[t.category_id] || null,
  }));
}

export async function getMonthlySpendingTrendOffline(opts = {}) {
  const m = opts.months ?? 6;
  const em = opts.endMonth ?? "";
  const ey = opts.endYear ?? "";
  const cacheKey = `trend:m:${m}:${ey}-${em}`;
  return swrRead({
    key: cacheKey,
    readCache: () => readRpcCache(cacheKey),
    fetchFresh: async () => {
      const result = await tryOnline(() => _getMonthlySpendingTrend(opts));
      if (!result.offline) return result.data;
      const rows = await loadCacheTransactionsWithCategoryJoin();
      return aggregateTrendFromCacheRows(rows, {
        months: opts.months ?? 6,
        endMonth: opts.endMonth,
        endYear: opts.endYear,
      });
    },
    writeCache: (value) => writeRpcCache(cacheKey, value),
    isEmpty: (v) => v == null,
  });
}

export async function getYearlySpendingTrendOffline(opts = {}) {
  const yrs = opts.years ?? 2;
  const em = opts.endMonth ?? "";
  const ey = opts.endYear ?? "";
  const cacheKey = `trend:y:${yrs}:${ey}-${em}`;
  return swrRead({
    key: cacheKey,
    readCache: () => readRpcCache(cacheKey),
    fetchFresh: async () => {
      const result = await tryOnline(() => _getYearlySpendingTrend(opts));
      if (!result.offline) return result.data;

      // Fold from cached transactions with the same accounting rules.
      const rows = await loadCacheTransactionsWithCategoryJoin();
      const years = opts.years ?? 2;
      const anchorEnd =
        opts.endMonth != null && opts.endYear != null
          ? new Date(opts.endYear, opts.endMonth, 0)
          : new Date();
      const startYear = anchorEnd.getFullYear() - years + 1;
      const startStr = `${startYear}-01-01`;
      const endStr = anchorEnd.toISOString().slice(0, 10);

      const map = {};
      for (const t of rows) {
        if (t.deleted_at) continue;
        if (t.transaction_date < startStr || t.transaction_date > endStr)
          continue;
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
    writeCache: (value) => writeRpcCache(cacheKey, value),
    isEmpty: (v) => v == null,
  });
}

// ── Transaction years ──────────────────────────────────────────────────────

/**
 * `[earliestYear .. currentYear+1]` — SWR over the `get_transaction_years` RPC.
 */
export async function getTransactionYearsOffline() {
  const cacheKey = "tx:years";
  return swrRead({
    key: cacheKey,
    readCache: () => readRpcCache(cacheKey),
    fetchFresh: async () => {
      const result = await tryOnline(() => _getTransactionYears());
      if (!result.offline) return result.data;

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
    writeCache: (value) => writeRpcCache(cacheKey, value),
    isEmpty: (v) => v == null,
  });
}
