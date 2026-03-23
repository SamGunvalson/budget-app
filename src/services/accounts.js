import { supabase, getCurrentUser } from "./supabase";
import { getUserPreference, setUserPreference } from "./categories";

/**
 * Account type constants and groupings.
 */
export const ACCOUNT_TYPES = {
  checking: { label: "Checking", group: "asset" },
  savings: { label: "Savings", group: "asset" },
  retirement: { label: "Retirement", group: "asset" },
  brokerage: { label: "Brokerage", group: "asset" },
  credit_card: { label: "Credit Card", group: "liability" },
  loan: { label: "Loan", group: "liability" },
  mortgage: { label: "Mortgage", group: "liability" },
};

/**
 * Returns true if the account type represents an asset (balance grows with income).
 */
export function isAssetAccount(type) {
  return ACCOUNT_TYPES[type]?.group === "asset";
}

/**
 * Returns true if the account type represents a liability (balance grows with charges).
 */
export function isLiabilityAccount(type) {
  return ACCOUNT_TYPES[type]?.group === "liability";
}

/**
 * Returns true if the account has been closed.
 */
export function isAccountClosed(account) {
  return Boolean(account?.closed_at);
}

/**
 * Human-readable label for an account type.
 */
export function formatAccountType(type) {
  return ACCOUNT_TYPES[type]?.label || type;
}

/**
 * Tailwind badge color classes for each account type.
 */
export function getAccountBadgeColor(type) {
  switch (type) {
    case "checking":
      return "bg-teal-700 text-teal-50";
    case "savings":
      return "bg-green-700 text-green-50";
    case "credit_card":
      return "bg-red-700 text-red-50";
    case "retirement":
      return "bg-violet-700 text-violet-50";
    case "brokerage":
      return "bg-fuchsia-700 text-fuchsia-50";
    case "loan":
      return "bg-yellow-700 text-yellow-50";
    case "mortgage":
      return "bg-orange-700 text-orange-50";
    default:
      return "bg-stone-500 text-stone-50";
  }
}

/**
 * Fetch all active accounts for the current user, ordered by type then name.
 * @returns {Promise<Array>}
 */
export async function getAccounts() {
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("is_active", true)
    .order("type")
    .order("name");

  if (error) throw error;
  return data;
}

/**
 * Fetch a single account by ID.
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function getAccount(id) {
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create a new account.
 * @param {{ name: string, type: string, starting_balance: number }} account
 * @returns {Promise<Object>} Created account
 */
export async function createAccount({ name, type, starting_balance = 0 }) {
  const user = await getCurrentUser();

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      user_id: user.id,
      name: name.trim(),
      type,
      starting_balance,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update an existing account.
 * @param {string} id
 * @param {{ name?: string, type?: string, starting_balance?: number, is_active?: boolean }} updates
 * @returns {Promise<Object>} Updated account
 */
export async function updateAccount(id, updates) {
  const user = await getCurrentUser();

  const payload = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.type !== undefined) payload.type = updates.type;
  if (updates.starting_balance !== undefined)
    payload.starting_balance = updates.starting_balance;
  if (updates.is_active !== undefined) payload.is_active = updates.is_active;
  if (updates.closed_at !== undefined) payload.closed_at = updates.closed_at;
  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("accounts")
    .update(payload)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Soft-delete an account by setting is_active = false.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteAccount(id) {
  const user = await getCurrentUser();

  const { error } = await supabase
    .from("accounts")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
}

/**
 * Calculate current balances for all active accounts.
 *
 * For each account: balance = starting_balance + net transaction impact.
 * - Asset accounts (checking, savings, retirement, brokerage):
 *     + income transactions, − expense transactions
 * - Liability accounts (credit_card, loan, mortgage):
 *     + expense transactions (charges), − income transactions (payments)
 *
 * @returns {Promise<Array<{
 *   id: string,
 *   name: string,
 *   type: string,
 *   starting_balance: number,
 *   transaction_net: number,
 *   balance: number,
 *   is_asset: boolean,
 * }>>}
 */
export async function getAccountBalances({ projectedToDate } = {}) {
  // Fetch all active accounts
  const accounts = await getAccounts();
  if (!accounts.length) return [];

  // Today's date string (YYYY-MM-DD) used to separate actual vs projected.
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Fetch transaction sums grouped by account_id.
  // We compute income_total and expense_total per account, split by status:
  //   posted (≤ today)  → actual balance
  //   pending            → near-term recurring (≤7 days)
  //   projected          → future recurring (>7 days)
  const PAGE_SIZE = 1000;
  let allTx = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("transactions")
      .select("account_id, amount, is_income, status, transaction_date")
      .is("deleted_at", null)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    allTx = allTx.concat(data);
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  // Aggregate per account — split posted (actual) / pending / projected
  const netByAccount = {};
  for (const tx of allTx) {
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
      // Future recurring transactions — included in projected balance only
      // Respect projectedToDate cap if provided
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

    // For assets: +income, -expense. For liabilities: +expense, -income
    const postedNet = asset
      ? sums.posted_income - sums.posted_expense
      : sums.posted_expense - sums.posted_income;

    const pendingNet = asset
      ? sums.pending_income - sums.pending_expense
      : sums.pending_expense - sums.pending_income;

    const projectedNet = asset
      ? sums.projected_income - sums.projected_expense
      : sums.projected_expense - sums.projected_income;

    const balance = acct.starting_balance + postedNet;
    // Projected balance = actual + near-term pending + future projected recurring
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
 * Compute monthly net worth history from the earliest transaction through the current month.
 *
 * Returns one data point per calendar month:
 *   { yearMonth: 'YYYY-MM', label: "Jan '24", netWorth, totalAssets, totalLiabilities }
 *
 * Only posted and pending transactions are included (projected is excluded).
 *
 * @returns {Promise<{ history: Array, projectedFuture: Array }>}
 */
export async function getNetWorthHistory({ projectedToDate } = {}) {
  const accounts = await getAccounts();
  if (!accounts.length) return { history: [], projectedFuture: [] };

  // Fetch all non-deleted transactions (posted + pending for history; projected for future)
  const PAGE_SIZE = 1000;
  let allTx = [];
  let from = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase
      .from("transactions")
      .select("account_id, amount, is_income, transaction_date, status")
      .is("deleted_at", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    allTx = allTx.concat(data);
    if (data.length < PAGE_SIZE) hasMore = false;
    else from += PAGE_SIZE;
  }

  const historyTx = allTx.filter((t) => t.status !== "projected");
  if (!historyTx.length) return { history: [], projectedFuture: [] };

  // Find earliest month from history transactions
  const sortedDates = historyTx
    .map((t) => t.transaction_date)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const earliest = sortedDates[0].slice(0, 7); // 'YYYY-MM'
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Build array of all months: earliest → current
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

  // Group history transactions by account → yearMonth
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

  // Build running balance series per account through current month
  const finalBalances = {}; // account id → running balance at end of current month
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

  // ── Build projected future months ──────────────────────────────────────
  // Group projected transactions by account → yearMonth.
  // Include both recurring-projected AND future-dated confirmed (posted) transactions.
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
  // Apply projectedToDate cap
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

  // Determine range of future months (month after current → latest projected transaction)
  const futureDates = cappedProjectedTx
    .map((t) => t.transaction_date)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const latestProjected = futureDates[futureDates.length - 1].slice(0, 7);

  const futureMonths = [];
  let [fy, fm] = current.split("-").map(Number);
  const [ly, lm] = latestProjected.split("-").map(Number);
  // Start from month AFTER current
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

  // Run projected balances forward from current-month-end balances
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

/**
 * Returns the latest transaction_date (YYYY-MM-DD) among all projected transactions,
 * or null if none exist.
 */
export async function getMaxProjectedDate() {
  const user = await getCurrentUser();
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // Max date from recurring-projected transactions
  const { data: projData, error: projErr } = await supabase
    .from("transactions")
    .select("transaction_date")
    .eq("user_id", user.id)
    .eq("status", "projected")
    .is("deleted_at", null)
    .order("transaction_date", { ascending: false })
    .limit(1);
  if (projErr) throw projErr;

  // Max date from future-dated confirmed (posted) transactions
  const { data: postedData, error: postedErr } = await supabase
    .from("transactions")
    .select("transaction_date")
    .eq("user_id", user.id)
    .eq("status", "posted")
    .gt("transaction_date", todayStr)
    .is("deleted_at", null)
    .order("transaction_date", { ascending: false })
    .limit(1);
  if (postedErr) throw postedErr;

  const dates = [
    projData?.[0]?.transaction_date,
    postedData?.[0]?.transaction_date,
  ].filter(Boolean);
  return dates.length
    ? dates.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).pop()
    : null;
}

/**
 * Calculate net worth = sum(asset balances) − sum(liability balances).
 * Liabilities are stored as positive "amount owed", so we subtract them.
 *
 * @returns {Promise<{ netWorth: number, totalAssets: number, totalLiabilities: number, accounts: Array }>}
 */
export async function getNetWorth() {
  const balances = await getAccountBalances();

  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const acct of balances) {
    if (acct.is_asset) {
      totalAssets += acct.balance;
    } else {
      totalLiabilities += acct.balance;
    }
  }

  return {
    netWorth: totalAssets - totalLiabilities,
    totalAssets,
    totalLiabilities,
    accounts: balances,
  };
}

/**
 * Close an account by setting closed_at to the given date.
 * @param {string} id
 * @param {string} closedAt - YYYY-MM-DD date string
 * @returns {Promise<Object>} Updated account
 */
export async function closeAccount(id, closedAt) {
  return updateAccount(id, { closed_at: closedAt });
}

/**
 * Reopen a closed account by clearing closed_at.
 * @param {string} id
 * @returns {Promise<Object>} Updated account
 */
export async function reopenAccount(id) {
  return updateAccount(id, { closed_at: null });
}

// ── Favorite Accounts ──

/**
 * Get the list of account IDs the user has marked as favorites.
 * @returns {Promise<string[]>} Array of account UUID strings
 */
export async function getFavoriteAccountIds() {
  return (await getUserPreference("favorite_accounts")) ?? [];
}

/**
 * Persist the full list of favorite account IDs.
 * @param {string[]} ids
 * @returns {Promise<void>}
 */
export async function setFavoriteAccountIds(ids) {
  await setUserPreference("favorite_accounts", ids);
}
