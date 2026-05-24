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
 * Backed by the `get_account_balances` Postgres RPC (Phase 3) — the database
 * does the bucketing per status × today/future and returns one row per
 * account already enriched with `balance`, `pending_net`,
 * `projected_balance`, `transaction_net`, and `is_asset`.
 *
 * @param {{ projectedToDate?: string }} [opts]
 * @returns {Promise<Array<{
 *   id: string,
 *   name: string,
 *   type: string,
 *   starting_balance: number,
 *   transaction_net: number,
 *   balance: number,
 *   pending_net: number,
 *   projected_balance: number,
 *   is_asset: boolean,
 * }>>}
 */
export async function getAccountBalances({ projectedToDate } = {}) {
  const { data, error } = await supabase.rpc("get_account_balances", {
    p_projected_to_date: projectedToDate ?? null,
  });
  if (error) throw error;
  // Coerce numeric columns the RPC returns as strings (bigint) into Number.
  return (data || []).map((row) => ({
    ...row,
    starting_balance: Number(row.starting_balance) || 0,
    transaction_net: Number(row.transaction_net) || 0,
    balance: Number(row.balance) || 0,
    pending_net: Number(row.pending_net) || 0,
    projected_balance: Number(row.projected_balance) || 0,
  }));
}

/**
 * Compute monthly net worth history from the earliest transaction through the current month.
 *
 * Backed by the `get_net_worth_history` Postgres RPC (Phase 3).  Returns the
 * same `{ history, projectedFuture }` shape the previous client-side
 * implementation produced — each entry is
 * `{ yearMonth, label, netWorth, totalAssets, totalLiabilities }`.
 *
 * Only posted and pending transactions feed the history series; the future
 * series additionally includes projected and future-dated posted rows,
 * capped by `projectedToDate` when supplied.
 *
 * @returns {Promise<{ history: Array, projectedFuture: Array }>}
 */
export async function getNetWorthHistory({ projectedToDate } = {}) {
  const { data, error } = await supabase.rpc("get_net_worth_history", {
    p_projected_to_date: projectedToDate ?? null,
  });
  if (error) throw error;
  const coerce = (entry) => ({
    ...entry,
    netWorth: Number(entry.netWorth) || 0,
    totalAssets: Number(entry.totalAssets) || 0,
    totalLiabilities: Number(entry.totalLiabilities) || 0,
  });
  return {
    history: (data?.history || []).map(coerce),
    projectedFuture: (data?.projectedFuture || []).map(coerce),
  };
}

/**
 * Returns the latest transaction_date (YYYY-MM-DD) among all projected transactions,
 * or null if none exist.
 */
export async function getMaxProjectedDate() {
  const user = await getCurrentUser();
  const now = new Date();
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

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

// ── Cashflow: per-account daily balance history ──

/**
 * Compute a daily running-balance series for the given accounts over a date range.
 *
 * Backed by the `get_account_balance_history` Postgres RPC (Phase 3).  Each
 * row is `{ date: 'YYYY-MM-DD', balances: { [accountId]: cents }, total: cents }`.
 * Past dates use posted+pending only; future dates additionally include
 * projected + future-dated posted rows.  The server clamps `startDate` to the
 * accounts' earliest transaction date so we never emit empty leading days.
 *
 * @param {{ accountIds: string[], startDate: string, endDate: string }} opts
 * @returns {Promise<Array<{ date: string, balances: Record<string, number>, total: number }>>}
 */
export async function getAccountBalanceHistory({
  accountIds,
  startDate,
  endDate,
}) {
  if (!accountIds?.length) return [];
  const { data, error } = await supabase.rpc("get_account_balance_history", {
    p_account_ids: accountIds,
    p_start: startDate,
    p_end: endDate,
  });
  if (error) throw error;
  return (data || []).map((row) => {
    const balances = {};
    if (row.balances && typeof row.balances === "object") {
      for (const [k, v] of Object.entries(row.balances)) {
        balances[k] = Number(v) || 0;
      }
    }
    return {
      date: row.date,
      balances,
      total: Number(row.total) || 0,
    };
  });
}

/**
 * Fetch upcoming (pending + projected) transactions for the given accounts.
 * Returns transactions sorted by date ascending with joined category/account data.
 *
 * @param {{ accountIds: string[], endDate?: string }} opts
 * @returns {Promise<Array>}
 */
export async function getUpcomingTransactions({ accountIds, endDate }) {
  if (!accountIds?.length) return [];

  const now = new Date();
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;
  while (hasMore) {
    let query = supabase
      .from("transactions")
      .select("*, categories(id, name, color, type), accounts(id, name, type)")
      .in("account_id", accountIds)
      .is("deleted_at", null)
      .or("status.eq.pending,status.eq.projected")
      .gte("transaction_date", todayStr)
      .order("transaction_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (endDate) query = query.lte("transaction_date", endDate);
    const { data, error } = await query;
    if (error) throw error;
    allData = allData.concat(data);
    if (data.length < PAGE_SIZE) hasMore = false;
    else from += PAGE_SIZE;
  }

  return allData;
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
