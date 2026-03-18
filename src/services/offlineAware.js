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
import db, { putOffline } from "./offlineDb";
import { enqueue } from "../utils/syncQueue";

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
 * Fetch transactions — Supabase first, fall back to IndexedDB.
 */
export async function getTransactionsOffline(filters = {}) {
  const result = await tryOnline(() => _getTransactions(filters));

  if (!result.offline) {
    // Cache result locally (non-blocking)
    cacheTransactions(result.data).catch(() => {});
    return result.data;
  }

  // Offline fallback — read from IndexedDB
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
 * Fetch YTD transactions — Supabase first, fall back to IndexedDB.
 */
export async function getTransactionsYTDOffline({ year, throughMonth }) {
  const result = await tryOnline(() =>
    _getTransactionsYTD({ year, throughMonth }),
  );

  if (!result.offline) {
    cacheTransactions(result.data).catch(() => {});
    return result.data;
  }

  // Offline fallback — filter from local cache
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

  // Attach cached category/account data for display
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
 * Fetch all transactions for a full year — Supabase first, fall back to IndexedDB.
 */
export async function getTransactionsForYearOffline({ year }) {
  const result = await tryOnline(() => _getTransactionsForYear({ year }));

  if (!result.offline) {
    cacheTransactions(result.data).catch(() => {});
    return result.data;
  }

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
  isAssetAccount,
} from "./accounts";

export async function getAccountsOffline() {
  const result = await tryOnline(() => _getAccounts());
  if (!result.offline) {
    cacheAccountsHelper(result.data).catch(() => {});
    return result.data;
  }
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
 * Fetch account balances — Supabase first, fall back to IndexedDB.
 */
export async function getAccountBalancesOffline({ projectedToDate } = {}) {
  const result = await tryOnline(() =>
    _getAccountBalances({ projectedToDate }),
  );
  if (!result.offline) {
    // Cache the underlying accounts (strip computed fields)
    const COMPUTED = [
      "transaction_net",
      "balance",
      "pending_net",
      "projected_balance",
      "is_asset",
    ];
    cacheAccountsHelper(
      result.data.map((row) => {
        const clean = { ...row };
        for (const k of COMPUTED) delete clean[k];
        return clean;
      }),
    ).catch(() => {});
    return result.data;
  }

  // Offline: compute from local cache
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
    const projectedBalance = balance + pendingNet + projectedNet;

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
    return;
  }
  const existing = await db.accounts.get(id);
  if (existing) {
    await putOffline("accounts", { ...existing, is_active: false }, "delete");
    await enqueue("accounts", id, "delete");
  }
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
  const result = await tryOnline(() => _getCategories());
  if (!result.offline) {
    cacheCategoriesHelper(result.data).catch(() => {});
    return result.data;
  }
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
  const result = await tryOnline(() => _getUserPreference(key));
  if (!result.offline) {
    // Cache locally
    if (result.data != null) {
      const row = await db.user_preferences
        .where("preference_key")
        .equals(key)
        .first();
      if (row) {
        await db.user_preferences.update(row.id, {
          preference_value: result.data,
        });
      }
    }
    return result.data;
  }
  const row = await db.user_preferences
    .where("preference_key")
    .equals(key)
    .first();
  return row?.preference_value ?? null;
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
  const result = await tryOnline(() => _getBudgetPlan(month, year));
  if (!result.offline) {
    if (result.data) await db.budget_plans.put(result.data);
    return result.data;
  }
  return db.budget_plans.where({ month, year }).first() || null;
}

export async function createBudgetPlanOffline(planData) {
  const result = await tryOnline(() => _createBudgetPlan(planData));
  if (!result.offline) {
    await db.budget_plans.put(result.data);
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
  const result = await tryOnline(() => _getBudgetItems(budgetPlanId));
  if (!result.offline) {
    // Cache items
    for (const item of result.data) {
      await db.budget_items.put(item);
    }
    return result.data;
  }
  return db.budget_items.where("budget_plan_id").equals(budgetPlanId).toArray();
}

export async function upsertBudgetItemOffline(itemData) {
  const result = await tryOnline(() => _upsertBudgetItem(itemData));
  if (!result.offline) {
    await db.budget_items.put(result.data);
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
